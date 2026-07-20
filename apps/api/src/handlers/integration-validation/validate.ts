// ---------------------------------------------------------------------------
// POST /api/v1/integrations/:integrationId/validate — the synchronous
// validation endpoint. A standalone, out-of-process surface that validates an
// order's state against an integration's declarative rules (POC plan).
//
// AUTH: API-key (M2M). Any valid, non-revoked `vnd_` key from ANY tenant is
// accepted — auth is applied as route-level middleware so it only runs on this
// exact route and other /integrations/* paths (e.g. the tenant-auth
// /integrations/ringcentral routes) still fall through.
//
// PRIOR-STATE RESOLUTION: the endpoint is stateless EXCEPT when the integration
// declares a projection binding (registry.ts) and the request omits `prior`. In
// that case, for a tenant-scoped key, it derives the record key from the
// canonical order and loads the caller-tenant's cached projection as `prior` so
// transition rules can run against last-known external state. An explicit
// `prior` in the body always wins; the platform-key path (null tenant) and
// projection-less integrations remain fully stateless. The lookup fails open to
// no-prior — a projection miss or error never blocks a save.
//
// Contract:
//   200 { valid, issues[], degraded }  — validation ran (degraded=true ⇒ failed
//                                          open internally; caller may proceed).
//   400 { error, code, correlationId } — request body wasn't valid JSON.
//   401 { error, code }                — missing/invalid API key.
//   403 { error, code }                — API key revoked.
//   404 { error, code, correlationId } — unknown integrationId.
//
// validateOrder fails open, so a validator defect never 5xxs the caller.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { z } from 'zod'
import { apiClientAuthMiddleware } from '../../middleware/api-client-auth'
import type { ApiClientVariables } from '../../types'
import {
  validateWithDefinition,
  mapToExternalWithDefinition,
  mapFromExternalWithDefinition,
  transformOrderToCanonical,
} from '../../integration-validation/validate'
import {
  resolveIntegrationDefinition,
  getFloor,
  listFloorIds,
} from '../../integration-validation/registry'
import type { IntegrationDefinition, ValidationInput } from '../../integration-validation/types'
import { mappingFormatJsonSchema } from '../../integration-validation/transform/mapping-format'
import { canonicalSchemaPaths } from '../../integration-validation/transform/mapping-static-check'
import { inboundBlockJsonSchema } from '../../lib/ingress'
import { createIntegrationProjectionRepository } from '../../repositories/integration-projection.repository'
import { db as basePrisma } from '../../db'
import { createTenantDb } from '../../lib/prisma'
import { logger } from '../../lib/logger'
import type { PrismaClient } from '@prisma/client'

// correlationId is injected by the root correlationMiddleware on every request;
// declare it alongside the API-key vars this route relies on.
type IntegrationValidationEnv = { Variables: ApiClientVariables & { correlationId: string } }

const ValidateBody = z.object({
  order: z.unknown(),
  prior: z.unknown().optional(),
  action: z.enum(['save', 'cancel', 'status-change']).optional(),
})

const MapToExternalBody = z.object({
  data: z.unknown(),
  action: z.enum(['save', 'cancel', 'status-change']).optional(),
})

const MapFromExternalBody = z.object({
  data: z.unknown(),
})

export const integrationValidationHandler = new Hono<IntegrationValidationEnv>()

// Published mapping-format JSON Schema — the documented standard a mapping
// document is authored against. PUBLIC (no auth): it is non-sensitive and
// authoring tools fetch it. Served with a 1-day cache hint.
integrationValidationHandler.get('/integrations/mapping-schema', (c) => {
  c.header('Cache-Control', 'public, max-age=86400')
  return c.json(mappingFormatJsonSchema() as object)
})

// Published JSON Schema for the `inbound` ingress block (sdk-feedback 0021).
// PUBLIC — the authoring contract for a config's ingress ack + validation.
integrationValidationHandler.get('/integrations/inbound-schema', (c) => {
  c.header('Cache-Control', 'public, max-age=86400')
  return c.json(inboundBlockJsonSchema() as object)
})

// Floor introspection (sdk-feedback 0024) — the machine-readable contract an
// author (or an AI agent) writes a config AGAINST: which canonical field paths a
// mapping may target, and which facts a rule may reference. PUBLIC + non-sensitive
// (it's the same code-defined contract the publish gate checks against), so an
// agent can self-serve without platform source. See the `pegasus://reference/floors`
// MCP resource and `PegasusClient.list_floors` / `get_floor`.

/** Build the machine-readable detail for one floor. */
function floorDetail(floorId: string): Record<string, unknown> | null {
  const floor = getFloor(floorId)
  if (!floor) return null
  const canonicalFields = [...canonicalSchemaPaths(z.toJSONSchema(floor.structuralContract))].sort()
  return {
    floor: floor.floor,
    // Legal mapping TARGET paths (a mapping may only write these). Array element
    // paths are marked with `[]` (e.g. "Resources[].Id").
    canonicalFields,
    // Legal rule FACTS (name → type). A rule's `fact` must be one of these; its
    // `field` must be one of `canonicalFields`.
    factCatalog: floor.factCatalog,
    // Legal mapping SOURCE roots (what a mapping's `$from` may READ). A bare entry
    // (`Survey`) opens a whole native root; a dotted entry
    // (`UnusedFields.survey_received`) opens only that curated sub-path, so an
    // author can see which specific legacy fields are readable without hitting the
    // gate blind (sdk-feedback 0028). Omitted for partner-neutral floors that
    // declare no input roots.
    ...(floor.inputFieldRoots ? { inputFieldRoots: floor.inputFieldRoots } : {}),
    defaultAction: floor.defaultAction,
    ...(floor.projection ? { projection: { entityType: floor.projection.entityType } } : {}),
  }
}

integrationValidationHandler.get('/integrations/floors', (c) => {
  c.header('Cache-Control', 'public, max-age=3600')
  const floors = listFloorIds()
    .map((id) => floorDetail(id))
    .filter((f): f is Record<string, unknown> => f !== null)
  return c.json({ data: floors })
})

integrationValidationHandler.get('/integrations/floors/:floorId', (c) => {
  const detail = floorDetail(c.req.param('floorId') ?? '')
  if (!detail) return c.json({ error: 'Unknown floor', code: 'NOT_FOUND' }, 404)
  c.header('Cache-Control', 'public, max-age=3600')
  return c.json({ data: detail })
})

integrationValidationHandler.post(
  '/integrations/:integrationId/validate',
  apiClientAuthMiddleware,
  async (c) => {
    const correlationId = c.get('correlationId')
    const integrationId = c.req.param('integrationId') ?? ''

    const parsed = ValidateBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: parsed.error.message, code: 'VALIDATION_ERROR', correlationId }, 400)
    }

    // Resolve the definition for THIS tenant's scope: a tenant's own published
    // config wins over GLOBAL over the built-in baseline, so a tenant-scoped
    // config actually governs the verdict. Fails open to the built-in baseline.
    const tenantId = c.get('tenantId')
    const def = await resolveIntegrationDefinition(basePrisma, integrationId, tenantId)
    if (!def) {
      return c.json(
        { error: `Unknown integration "${integrationId}"`, code: 'NOT_FOUND', correlationId },
        404,
      )
    }

    const input = parsed.data as ValidationInput

    // Prior-state resolution: when the caller didn't supply `prior` and the
    // integration declares a projection binding, load the record's last-known
    // state from the tenant's projection cache. Fails open to no-prior.
    if (input.prior === undefined || input.prior === null) {
      const resolved = await resolveProjectionPrior(def, input, tenantId)
      if (resolved !== undefined) input.prior = resolved
    }

    return c.json(validateWithDefinition(def, input))
  },
)

// POST /integrations/:integrationId/map-to-external — project entity data into
// the integration's external payload shape and return it, plus the same
// validation verdict the /validate route gives. A workflow uses this to build
// the JSON body for the partner API; `valid` lets it gate the send. Stateless:
// no prior/projection lookup — merging into a cached projection is the caller's
// job (get_projection → this → merge → put_projection). Same open-key auth as
// /validate.
integrationValidationHandler.post(
  '/integrations/:integrationId/map-to-external',
  apiClientAuthMiddleware,
  async (c) => {
    const correlationId = c.get('correlationId')
    const integrationId = c.req.param('integrationId') ?? ''

    const parsed = MapToExternalBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: parsed.error.message, code: 'VALIDATION_ERROR', correlationId }, 400)
    }

    // Resolve the definition for THIS tenant's scope (own → GLOBAL → built-in),
    // so a tenant's own mapping/rules shape the projected payload and verdict.
    const def = await resolveIntegrationDefinition(basePrisma, integrationId, c.get('tenantId'))
    if (!def) {
      return c.json(
        { error: `Unknown integration "${integrationId}"`, code: 'NOT_FOUND', correlationId },
        404,
      )
    }

    return c.json(mapToExternalWithDefinition(def, parsed.data.data, parsed.data.action))
  },
)

// POST /integrations/:integrationId/map-from-external — the INBOUND mirror of
// map-to-external (sdk-feedback 0024). Normalize a partner's NATIVE payload into
// the integration's CANONICAL entity and return it plus the gate verdict. An
// ingest workflow (0021 inbound events) uses `canonical` as the system-of-record
// shape and `valid` to fail closed. FAILS CLOSED on an unknown integration / no
// floor (404) so an ingest never proceeds on a silently-empty entity. Same
// open-key auth + tenant-scope resolution as /validate and /map-to-external.
integrationValidationHandler.post(
  '/integrations/:integrationId/map-from-external',
  apiClientAuthMiddleware,
  async (c) => {
    const correlationId = c.get('correlationId')
    const integrationId = c.req.param('integrationId') ?? ''

    const parsed = MapFromExternalBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: parsed.error.message, code: 'VALIDATION_ERROR', correlationId }, 400)
    }

    const def = await resolveIntegrationDefinition(basePrisma, integrationId, c.get('tenantId'))
    if (!def) {
      return c.json(
        { error: `Unknown integration "${integrationId}"`, code: 'NOT_FOUND', correlationId },
        404,
      )
    }

    return c.json(mapFromExternalWithDefinition(def, parsed.data.data))
  },
)

/**
 * Resolve the cached projection state to use as `prior` for this validation.
 * Takes the already tenant-resolved definition so the projection key is derived
 * with the SAME transform that governs the verdict. Returns the cached native
 * state, or `undefined` when no projection should be applied (no binding, no
 * tenant scope, unkeyable order, miss, or any error). Never throws — a
 * projection problem must never block a save.
 */
async function resolveProjectionPrior(
  def: IntegrationDefinition,
  input: ValidationInput,
  tenantId: string | null,
): Promise<unknown | undefined> {
  // Platform-scoped keys (null tenant) have no projection namespace to read.
  if (!tenantId) return undefined
  if (!def.projection) return undefined

  try {
    const canonical = transformOrderToCanonical(def, input.order)
    if (canonical === null) return undefined
    const entityKey = def.projection.key(canonical)
    if (!entityKey) return undefined

    const tenantDb = createTenantDb(basePrisma, tenantId)
    const repo = createIntegrationProjectionRepository(tenantDb as unknown as PrismaClient)
    const state = await repo.findState(def.id, def.projection.entityType, entityKey)
    return state ?? undefined
  } catch (err) {
    logger.warn('integration projection prior lookup failed open', {
      integrationId: def.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}
