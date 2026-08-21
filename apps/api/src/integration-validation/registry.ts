// ---------------------------------------------------------------------------
// Integration registry — the floor(type) + overlay(partner) seam (sdk-feedback
// 0019 + 0020).
//
// TWO code layers, kept as DATA:
//   - FLOORS: per-*type* fact abstractions (TypeFloor) — the neutral canonical
//     shape, fact derivation, fact catalog, input roots, projection. Reusable
//     across partners of the same integration type.
//   - BUILTIN_OVERLAYS: per-*partner* overlays (IntegrationOverlay) — the
//     native→canonical mapping, displayName, rules, and the partner's own
//     external output shape + canonical→external projection. Each references a
//     floor by id.
//
// A runtime `IntegrationDefinition` is the COMPOSITION of a floor and an overlay
// (composeDefinition). Consumers (validate, gate, list) still use that single
// resolved object. A published DB config (IntegrationConfig) is a per-tenant /
// GLOBAL overlay: it overrides the editable surface (mapping, rules, displayName,
// externalShape, externalMapping) and — the 0020 win — may reference a floor by
// id, so a NEW partner on an existing type is authorable as an overlay ALONE,
// with no built-in code entry of its own.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import {
  compileMapping,
  MappingTemplateSchema,
  type MappingTemplate,
} from './transform/mapping-format'
import { RuleSetSchema, type RuleSet } from './rules/types'
import { shipmentStatusUpdateFloor } from './floors/shipment-status-update.floor'
import { shipmentLifecycleEventFloor } from './floors/shipment-lifecycle-event.floor'
import { salesLeadFloor } from './floors/sales-lead.floor'
import { financialSettlementFloor } from './floors/financial-settlement.floor'
import { documentRecordFloor } from './floors/document-record.floor'
import { demoPartnerOverlay } from './overlays/demo-partner.overlay'
import { alliedStatusOverlay } from './overlays/allied-status.overlay'
import { createIntegrationConfigRepository } from '../repositories/integration-config.repository'
import { logger } from '../lib/logger'
import type { IntegrationConfigRow } from '../repositories/integration-config.repository'
import type {
  IntegrationDefinition,
  IntegrationOverlay,
  SecretRequirement,
  TypeFloor,
} from './types'

/**
 * Coerce a stored JSON value into a SecretRequirement[] defensively (the DB
 * column is untyped Json). Drops entries without a string `key`; a blank group
 * is left undefined so it resolves to the store's "global" default. Exported for
 * unit testing of the defensive paths.
 */
export function coerceRequirements(value: unknown): SecretRequirement[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: SecretRequirement[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (typeof r.key !== 'string' || r.key === '') continue
    out.push({
      key: r.key,
      ...(typeof r.group === 'string' && r.group !== '' ? { group: r.group } : {}),
      ...(typeof r.description === 'string' ? { description: r.description } : {}),
    })
  }
  return out.length ? out : undefined
}

// ── Built-in floors (types) and overlays (partners) ────────────────────────

/** Per-*type* fact abstractions, keyed by floor id. Partner-neutral, reusable. */
const FLOORS: Record<string, TypeFloor> = {
  [shipmentStatusUpdateFloor.floor]: shipmentStatusUpdateFloor,
  // Generic inbound-ingest floors (sdk-feedback 0024). Partner-neutral, reusable —
  // Sirva ADE is the first partner to build on them, via published config overlays
  // (no built-in overlay: the mapping + rules live in configuration, not code).
  [shipmentLifecycleEventFloor.floor]: shipmentLifecycleEventFloor,
  [salesLeadFloor.floor]: salesLeadFloor,
  [financialSettlementFloor.floor]: financialSettlementFloor,
  [documentRecordFloor.floor]: documentRecordFloor,
}

/** Built-in per-*partner* overlays, keyed by integrationId. Each names a floor. */
const BUILTIN_OVERLAYS: Record<string, IntegrationOverlay> = {
  [demoPartnerOverlay.id]: demoPartnerOverlay,
  [alliedStatusOverlay.id]: alliedStatusOverlay,
}

// ── Composition: floor ⊕ overlay → resolved IntegrationDefinition ───────────

/** Normalized overlay parts (built-in or DB-derived) ready to compose onto a floor. */
interface OverlayParts {
  id: string
  displayName: string
  description: string
  mapping: MappingTemplate
  rules: RuleSet
  /** External output shape as a JSON Schema. Undefined ⇒ identity (external == canonical). */
  externalShape?: Record<string, unknown>
  /** Canonical → external projection. Undefined ⇒ identity. */
  externalMapping?: MappingTemplate
  /** Declared secret/config keys the integration reads (informational). */
  requiredSecrets?: SecretRequirement[]
  requiredConfigs?: SecretRequirement[]
}

/** Compose a floor and overlay parts into the resolved definition consumers use. */
function composeDefinition(floor: TypeFloor, parts: OverlayParts): IntegrationDefinition {
  return {
    id: parts.id,
    floor: floor.floor,
    displayName: parts.displayName,
    description: parts.description,
    structuralContract: floor.structuralContract,
    mapping: parts.mapping,
    transform: compileMapping(parts.mapping),
    ...(floor.inputFieldRoots ? { inputFieldRoots: floor.inputFieldRoots } : {}),
    deriveFacts: floor.deriveFacts,
    factCatalog: floor.factCatalog,
    rules: parts.rules,
    defaultAction: floor.defaultAction,
    ...(floor.projection ? { projection: floor.projection } : {}),
    ...(floor.correlation ? { correlation: floor.correlation } : {}),
    ...(parts.externalShape ? { externalJsonSchema: parts.externalShape } : {}),
    ...(parts.externalMapping ? { externalTransform: compileMapping(parts.externalMapping) } : {}),
    ...(parts.requiredSecrets ? { requiredSecrets: parts.requiredSecrets } : {}),
    ...(parts.requiredConfigs ? { requiredConfigs: parts.requiredConfigs } : {}),
  }
}

/**
 * Resolve raw overlay input (a built-in overlay or a DB config row already parsed
 * into MappingTemplate/RuleSet) into a full IntegrationDefinition. A field the
 * input omits falls back to the built-in overlay for that id (so a DB row can set
 * only what it changes); `floor` falls back to the built-in overlay's floor.
 * Returns null when no floor can be resolved — the "unknown integration" case.
 */
function resolveComposed(input: {
  id: string
  floorId?: string
  displayName?: string
  mapping: MappingTemplate
  rules: RuleSet
  externalShape?: Record<string, unknown>
  externalMapping?: MappingTemplate
  requiredSecrets?: SecretRequirement[]
  requiredConfigs?: SecretRequirement[]
}): IntegrationDefinition | null {
  const builtIn = BUILTIN_OVERLAYS[input.id]
  const floorId = input.floorId ?? builtIn?.floor
  const floor = floorId ? FLOORS[floorId] : undefined
  if (!floor) return null

  const externalShape = input.externalShape ?? builtIn?.externalShape
  const externalMapping = input.externalMapping ?? builtIn?.externalMapping
  const requiredSecrets = input.requiredSecrets ?? builtIn?.requiredSecrets
  const requiredConfigs = input.requiredConfigs ?? builtIn?.requiredConfigs
  const parts: OverlayParts = {
    id: input.id,
    displayName: input.displayName ?? builtIn?.displayName ?? input.id,
    description: builtIn?.description ?? '',
    mapping: input.mapping,
    rules: input.rules,
    ...(externalShape ? { externalShape } : {}),
    ...(externalMapping ? { externalMapping } : {}),
    ...(requiredSecrets ? { requiredSecrets } : {}),
    ...(requiredConfigs ? { requiredConfigs } : {}),
  }
  return composeDefinition(floor, parts)
}

/** Built-in overlay composed onto its floor — the always-valid code baseline. */
function composeBuiltIn(overlay: IntegrationOverlay): IntegrationDefinition {
  const floor = FLOORS[overlay.floor]
  if (!floor) {
    // A built-in overlay must reference a known floor — a programming error.
    throw new Error(`built-in overlay "${overlay.id}" references unknown floor "${overlay.floor}"`)
  }
  return composeDefinition(floor, {
    id: overlay.id,
    displayName: overlay.displayName,
    description: overlay.description ?? '',
    mapping: overlay.mapping,
    rules: overlay.rules,
    ...(overlay.externalShape ? { externalShape: overlay.externalShape } : {}),
    ...(overlay.externalMapping ? { externalMapping: overlay.externalMapping } : {}),
    ...(overlay.requiredSecrets ? { requiredSecrets: overlay.requiredSecrets } : {}),
    ...(overlay.requiredConfigs ? { requiredConfigs: overlay.requiredConfigs } : {}),
  })
}

/**
 * Built-in resolved definitions, keyed by integrationId. The CODE ground truth
 * (floor's structuralContract/deriveFacts/factCatalog/inputFieldRoots) a
 * DB-published config can never override.
 */
const REGISTRY: Record<string, IntegrationDefinition> = Object.fromEntries(
  Object.values(BUILTIN_OVERLAYS).map((o) => [o.id, composeBuiltIn(o)]),
)

// ── DB-backed overlay cache (GLOBAL) ────────────────────────────────────────
//
// A published GLOBAL config overrides the editable surface of its integration
// and may introduce a NEW integration id (referencing an existing floor). The
// overlay is a module-level cache warmed from the DB with a TTL, so
// getIntegrationDefinition stays synchronous. A built-in floor is the safe
// baseline: an absent, stale, or unparseable overlay falls back to code.

const DEFAULT_OVERLAY_TTL_MS = 60_000

let overlay: Map<string, IntegrationDefinition> | null = null
let overlayLoadedAt = 0

/**
 * Parse + compose a DB config row into a resolved IntegrationDefinition, or null
 * when the row can't be trusted (unparseable/uncompilable mapping/rules/external
 * mapping, or an unknown floor). Shared by the GLOBAL overlay build and the
 * per-request tenant resolver so both apply — and reject — a row identically.
 *
 * Exported so the list/discovery endpoints can resolve a TENANT-scoped row whose
 * integration id has no built-in and is absent from the GLOBAL overlay — without
 * it, such a row has no resolvable displayName to show.
 */
export function toDefinitionFromRow(row: IntegrationConfigRow): IntegrationDefinition | null {
  const mapping = MappingTemplateSchema.safeParse(row.mapping)
  const rules = RuleSetSchema.safeParse(row.rules)
  if (!mapping.success || !rules.success) {
    logger.warn('integration config row failed to parse — ignoring', {
      integrationId: row.integrationId,
      version: row.version,
    })
    return null
  }

  let externalMapping: MappingTemplate | undefined
  if (row.externalMapping != null) {
    const parsed = MappingTemplateSchema.safeParse(row.externalMapping)
    if (!parsed.success) {
      logger.warn('integration config external mapping failed to parse — ignoring', {
        integrationId: row.integrationId,
        version: row.version,
      })
      return null
    }
    externalMapping = parsed.data
  }

  const externalShape =
    row.externalShape != null && typeof row.externalShape === 'object'
      ? (row.externalShape as Record<string, unknown>)
      : undefined

  try {
    const requiredSecrets = coerceRequirements(row.requiredSecrets)
    const requiredConfigs = coerceRequirements(row.requiredConfigs)
    return resolveComposed({
      id: row.integrationId,
      ...(row.floor ? { floorId: row.floor } : {}),
      ...(row.displayName ? { displayName: row.displayName } : {}),
      mapping: mapping.data,
      rules: rules.data,
      ...(externalShape ? { externalShape } : {}),
      ...(externalMapping ? { externalMapping } : {}),
      ...(requiredSecrets ? { requiredSecrets } : {}),
      ...(requiredConfigs ? { requiredConfigs } : {}),
    })
  } catch (err) {
    logger.warn('integration config row failed to compose — ignoring', {
      integrationId: row.integrationId,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/** Build the overlay map from the active GLOBAL configs, skipping unresolvable rows. */
async function buildOverlay(db: PrismaClient): Promise<Map<string, IntegrationDefinition>> {
  const repo = createIntegrationConfigRepository(db)
  const next = new Map<string, IntegrationDefinition>()
  for (const row of await repo.listActiveGlobal()) {
    // A row referencing an unknown floor (and with no built-in base) resolves to
    // null and is skipped — it can never take effect.
    const def = toDefinitionFromRow(row)
    if (def) next.set(row.integrationId, def)
  }
  return next
}

/** Force a reload of the overlay from the DB. Call after a publish/rollback. */
export async function refreshRegistryOverlay(db: PrismaClient): Promise<void> {
  overlay = await buildOverlay(db)
  overlayLoadedAt = Date.now()
}

/**
 * Reload the overlay if it has never been loaded or its TTL has elapsed. Call at
 * request start (e.g. in the validate handler) before getIntegrationDefinition.
 * Failures are swallowed — the built-in baseline keeps serving.
 */
export async function loadRegistryOverlayIfStale(
  db: PrismaClient,
  ttlMs: number = DEFAULT_OVERLAY_TTL_MS,
): Promise<void> {
  if (overlay && Date.now() - overlayLoadedAt < ttlMs) return
  try {
    await refreshRegistryOverlay(db)
  } catch (err) {
    logger.warn('integration config overlay refresh failed — serving built-in baseline', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * NOT a total lookup — it only sees whatever the in-process overlay happens to
 * hold, which is nothing at all in a container that has never served a config
 * publish or a warming call. A REQUEST-SERVING caller must therefore go through
 * `resolveIntegrationDefinition` (per-request, DB-backed, tenant-aware), or a
 * config-only integration — one with no built-in entry, the very thing
 * sdk-feedback 0020 enabled — resolves on some containers and 404s on others
 * (sdk-feedback 0038). This synchronous form is for callers that have already
 * warmed the overlay, or that only need the built-in baseline.
 */
export function getIntegrationDefinition(id: string): IntegrationDefinition | undefined {
  // A GLOBAL overlay wins (it may also be a NEW partner with no built-in), else
  // the built-in baseline.
  return overlay?.get(id) ?? REGISTRY[id]
}

/**
 * The pure built-in (code) definition — never merged with any published config.
 * The publish/gate path validates candidate configs against this ground truth
 * so an already-live overlay can't influence what a new config is checked against.
 */
export function getBuiltInDefinition(id: string): IntegrationDefinition | undefined {
  return REGISTRY[id]
}

/** A type floor by id (the fact-abstraction ground truth). */
export function getFloor(floorId: string): TypeFloor | undefined {
  return FLOORS[floorId]
}

/** All known type-floor ids. */
export function listFloorIds(): string[] {
  return Object.keys(FLOORS)
}

/**
 * The ground-truth base definition the publish gate checks a candidate against.
 * For a built-in id, that is its resolved built-in definition. For a NEW partner
 * id (no built-in), it is a bare definition composed from the named floor with a
 * placeholder editable surface (the candidate overrides mapping/rules). Returns
 * undefined when neither a built-in nor a known floor applies.
 */
export function getGateBase(
  integrationId: string,
  floorId?: string,
): IntegrationDefinition | undefined {
  const builtIn = REGISTRY[integrationId]
  if (builtIn && (!floorId || floorId === builtIn.floor)) return builtIn

  const floor = floorId ? FLOORS[floorId] : builtIn ? FLOORS[builtIn.floor] : undefined
  if (!floor) return undefined
  // Placeholder editable surface — the gate spreads the candidate's mapping/rules
  // on top, so these are never used to check anything.
  return composeDefinition(floor, {
    id: integrationId,
    displayName: integrationId,
    description: '',
    mapping: {},
    rules: [],
  })
}

/**
 * Resolve the definition that governs RUNTIME validation for a caller in a given
 * tenant scope. Honors tenant-over-GLOBAL-over-built-in precedence
 * (`findActiveForScope`): a tenant's own published config wins, else the GLOBAL
 * platform config, else the built-in baseline. So a TENANT-scoped config actually
 * changes what that tenant's orders are validated against — it is not display-only.
 *
 * - `tenantId === null` (platform-scoped key): the GLOBAL overlay is the whole
 *   story — defers to the cached overlay path.
 * - Reads the tenant's active row fresh per request (no TTL lag → a publish takes
 *   effect immediately), and FAILS OPEN to the built-in baseline on any DB error
 *   or unparseable row.
 */
export async function resolveIntegrationDefinition(
  db: PrismaClient,
  id: string,
  tenantId: string | null,
): Promise<IntegrationDefinition | undefined> {
  // Platform-scoped keys have no tenant of their own — GLOBAL is all that applies.
  if (!tenantId) {
    await loadRegistryOverlayIfStale(db)
    return getIntegrationDefinition(id)
  }

  try {
    const repo = createIntegrationConfigRepository(db)
    const row = await repo.findActiveForScope(id, tenantId)
    // No row → built-in (undefined for a genuinely unknown id → 404). A row that
    // fails to resolve falls back to the built-in baseline too.
    if (!row) return REGISTRY[id]
    return toDefinitionFromRow(row) ?? REGISTRY[id]
  } catch (err) {
    logger.warn('integration definition resolve failed — serving built-in baseline', {
      integrationId: id,
      error: err instanceof Error ? err.message : String(err),
    })
    return REGISTRY[id]
  }
}

/**
 * Known integration ids — built-ins plus any GLOBAL-overlay (new-partner) ids.
 *
 * SYNCHRONOUS, so it reports whatever the overlay cache happens to hold: in a
 * process that has never published or served a platform-scoped request, the
 * overlay is null and this returns the built-ins ALONE. Read-only listing
 * endpoints must use `listIntegrationIdsForScope`, which warms the overlay and
 * adds the caller's own tenant-scoped ids.
 */
export function listIntegrationIds(): string[] {
  const ids = new Set<string>(Object.keys(REGISTRY))
  if (overlay) for (const id of overlay.keys()) ids.add(id)
  return [...ids]
}

/**
 * Every integration id that applies to one tenant:
 * built-ins ∪ GLOBAL-overlay ids ∪ the tenant's OWN published ids.
 *
 * Warms the overlay first (`loadRegistryOverlayIfStale`), so a caller that has
 * only ever served UI traffic still sees GLOBAL new-partner ids — the cache is
 * otherwise populated only by a publish in this same container or by a
 * platform-scoped (`tenantId === null`) resolve.
 *
 * Fails open: a DB error degrades to the synchronous built-in ∪ overlay set
 * rather than erroring the caller's page.
 */
export async function listIntegrationIdsForScope(
  db: PrismaClient,
  tenantId: string,
): Promise<string[]> {
  await loadRegistryOverlayIfStale(db)
  const ids = new Set<string>(listIntegrationIds())
  try {
    const repo = createIntegrationConfigRepository(db)
    for (const id of await repo.listActiveIntegrationIdsForTenant(tenantId)) ids.add(id)
  } catch (err) {
    logger.warn('tenant integration id lookup failed — listing built-ins + GLOBAL only', {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return [...ids]
}
