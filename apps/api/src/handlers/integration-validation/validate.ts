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
  validateOrder,
  mapToExternal,
  transformOrderToCanonical,
  UnknownIntegrationError,
} from '../../integration-validation/validate'
import {
  loadRegistryOverlayIfStale,
  getIntegrationDefinition,
} from '../../integration-validation/registry'
import type { ValidationInput } from '../../integration-validation/types'
import { mappingFormatJsonSchema } from '../../integration-validation/transform/mapping-format'
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

export const integrationValidationHandler = new Hono<IntegrationValidationEnv>()

// Published mapping-format JSON Schema — the documented standard a mapping
// document is authored against. PUBLIC (no auth): it is non-sensitive and
// authoring tools fetch it. Served with a 1-day cache hint.
integrationValidationHandler.get('/integrations/mapping-schema', (c) => {
  c.header('Cache-Control', 'public, max-age=86400')
  return c.json(mappingFormatJsonSchema() as object)
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

    // Warm the registry overlay so any published config is reflected. Best-effort
    // and TTL-throttled; failures fall back to the built-in baseline.
    await loadRegistryOverlayIfStale(basePrisma)

    const input = parsed.data as ValidationInput

    // Prior-state resolution: when the caller didn't supply `prior` and the
    // integration declares a projection binding, load the record's last-known
    // state from the tenant's projection cache. Fails open to no-prior.
    if (input.prior === undefined || input.prior === null) {
      const resolved = await resolveProjectionPrior(integrationId, input, c.get('tenantId'))
      if (resolved !== undefined) input.prior = resolved
    }

    try {
      const result = validateOrder(integrationId, input)
      return c.json(result)
    } catch (err) {
      if (err instanceof UnknownIntegrationError) {
        return c.json({ error: err.message, code: 'NOT_FOUND', correlationId }, 404)
      }
      throw err
    }
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

    // Warm the registry overlay so any published config is reflected. Best-effort
    // and TTL-throttled; failures fall back to the built-in baseline.
    await loadRegistryOverlayIfStale(basePrisma)

    try {
      return c.json(mapToExternal(integrationId, parsed.data.data, parsed.data.action))
    } catch (err) {
      if (err instanceof UnknownIntegrationError) {
        return c.json({ error: err.message, code: 'NOT_FOUND', correlationId }, 404)
      }
      throw err
    }
  },
)

/**
 * Resolve the cached projection state to use as `prior` for this validation.
 * Returns the cached native state, or `undefined` when no projection should be
 * applied (no binding, no tenant scope, unkeyable order, miss, or any error).
 * Never throws — a projection problem must never block a save.
 */
async function resolveProjectionPrior(
  integrationId: string,
  input: ValidationInput,
  tenantId: string | null,
): Promise<unknown | undefined> {
  // Platform-scoped keys (null tenant) have no projection namespace to read.
  if (!tenantId) return undefined

  const def = getIntegrationDefinition(integrationId)
  if (!def?.projection) return undefined

  try {
    const canonical = transformOrderToCanonical(def, input.order)
    if (canonical === null) return undefined
    const entityKey = def.projection.key(canonical)
    if (!entityKey) return undefined

    const tenantDb = createTenantDb(basePrisma, tenantId)
    const repo = createIntegrationProjectionRepository(tenantDb as unknown as PrismaClient)
    const state = await repo.findState(integrationId, def.projection.entityType, entityKey)
    return state ?? undefined
  } catch (err) {
    logger.warn('integration projection prior lookup failed open', {
      integrationId,
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}
