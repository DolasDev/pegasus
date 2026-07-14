// ---------------------------------------------------------------------------
// Integration registry — the multi-integration seam, kept as DATA from day one.
//
// Ships one entry (demo_partner — a fictional example/reference integration),
// supported globally (a single shared definition, not per-tenant). Adding an
// integration is a new entry here plus its own transform/rules/facts files; the
// engine and the endpoint never change. Nothing about a specific integration is
// referenced outside this map. (An earlier POC entry was removed — see git
// history — and can be re-added the same way if needed.)
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import { DemoPartnerOrderSchema } from './canonical-demo-partner'
import {
  compileMapping,
  MappingTemplateSchema,
  type MappingTemplate,
} from './transform/mapping-format'
import { demoPartnerMapping, demoPartnerInputFieldRoots } from './transform/demo-partner.transform'
import { deriveDemoPartnerFacts, demoPartnerFactCatalog } from './facts/demo-partner-facts'
import { demoPartnerRules } from './rules/demo-partner.rules'
import { RuleSetSchema, type RuleSet } from './rules/types'
import { createIntegrationConfigRepository } from '../repositories/integration-config.repository'
import { logger } from '../lib/logger'
import type { TransformSpec } from './transform/engine'
import type { IntegrationDefinition } from './types'

const demoPartnerDefinition: IntegrationDefinition = {
  id: 'demo_partner',
  displayName: 'Demo Partner',
  description: 'Validates Demo Partner order payloads before they are saved.',
  structuralContract: DemoPartnerOrderSchema,
  mapping: demoPartnerMapping,
  transform: compileMapping(demoPartnerMapping),
  inputFieldRoots: demoPartnerInputFieldRoots,
  deriveFacts: deriveDemoPartnerFacts,
  factCatalog: demoPartnerFactCatalog,
  rules: demoPartnerRules,
  defaultAction: 'save',
  // Cached-projection binding: a Demo Partner order is keyed by its service
  // order number, so the validator can load the order's last-known state as
  // `prior`.
  projection: {
    entityType: 'order',
    key: (o) => (typeof o?.serviceOrderNumber === 'string' ? o.serviceOrderNumber : null),
  },
}

// Built-in definitions are the always-valid baseline (guaranteed by CI). They
// supply the CODE ground truth — structuralContract, deriveFacts, factCatalog,
// inputFieldRoots — that a DB-published config can never override.
const REGISTRY: Record<string, IntegrationDefinition> = {
  demo_partner: demoPartnerDefinition,
}

// ---------------------------------------------------------------------------
// DB-backed overlay
//
// A published GLOBAL config overrides ONLY the editable surface (mapping +
// rules) of its built-in definition. The overlay is a module-level cache warmed
// from the DB with a TTL (the JWKS-cache precedent in middleware/admin-auth.ts),
// so getIntegrationDefinition stays synchronous — validateOrder and the
// in-process cloud save path are unchanged. The built-in baseline is the safe
// floor: an absent, stale, or unparseable overlay simply falls back to code.
// ---------------------------------------------------------------------------

interface OverlayEntry {
  mapping: MappingTemplate
  transform: TransformSpec
  rules: RuleSet
}

const DEFAULT_OVERLAY_TTL_MS = 60_000

let overlay: Map<string, OverlayEntry> | null = null
let overlayLoadedAt = 0

/**
 * Parse + compile a config row's editable surface (mapping + rules) into an
 * overlay entry, or null when the row can't be trusted (unparseable mapping/
 * rules or a compile error). Shared by the GLOBAL overlay build and the
 * per-request tenant resolver so both apply — and reject — a row identically.
 */
function toOverlayEntry(
  integrationId: string,
  mappingJson: unknown,
  rulesJson: unknown,
  version?: number,
): OverlayEntry | null {
  const mapping = MappingTemplateSchema.safeParse(mappingJson)
  const rules = RuleSetSchema.safeParse(rulesJson)
  if (!mapping.success || !rules.success) {
    logger.warn('integration config row failed to parse — ignoring', { integrationId, version })
    return null
  }
  try {
    return {
      mapping: mapping.data,
      transform: compileMapping(mapping.data),
      rules: rules.data,
    }
  } catch (err) {
    logger.warn('integration config row failed to compile — ignoring', {
      integrationId,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/** Merge an overlay entry's editable surface onto a built-in definition. */
function mergeDefinition(
  builtIn: IntegrationDefinition,
  entry: OverlayEntry,
): IntegrationDefinition {
  return { ...builtIn, mapping: entry.mapping, transform: entry.transform, rules: entry.rules }
}

/** Build the overlay map from the active GLOBAL configs, skipping unparseable rows. */
async function buildOverlay(db: PrismaClient): Promise<Map<string, OverlayEntry>> {
  const repo = createIntegrationConfigRepository(db)
  const next = new Map<string, OverlayEntry>()
  for (const row of await repo.listActiveGlobal()) {
    // Only the editable surface is overlaid; an unknown integration id has no
    // built-in base to merge onto, so it can never take effect — skip early.
    if (!REGISTRY[row.integrationId]) continue
    const entry = toOverlayEntry(row.integrationId, row.mapping, row.rules, row.version)
    if (entry) next.set(row.integrationId, entry)
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

export function getIntegrationDefinition(id: string): IntegrationDefinition | undefined {
  const builtIn = REGISTRY[id]
  if (!builtIn) return undefined
  const entry = overlay?.get(id)
  return entry ? mergeDefinition(builtIn, entry) : builtIn
}

/**
 * The pure built-in (code) definition — never merged with any published config.
 * The publish/gate path validates candidate configs against this ground truth
 * so an already-live overlay can't influence what a new config is checked against.
 */
export function getBuiltInDefinition(id: string): IntegrationDefinition | undefined {
  return REGISTRY[id]
}

/**
 * Resolve the definition that governs RUNTIME validation for a caller in a given
 * tenant scope. Unlike getIntegrationDefinition (which serves only the GLOBAL
 * overlay), this honours the same tenant-over-GLOBAL precedence as the config
 * read path (`findActiveForScope`): a tenant's own published config wins, else
 * the GLOBAL platform config, else the built-in baseline. So a TENANT-scoped
 * config actually changes what that tenant's orders are validated against — it
 * is not display-only.
 *
 * - `tenantId === null` (platform-scoped key): no tenant namespace, so the GLOBAL
 *   overlay is the whole story — defers to the cached overlay path unchanged.
 * - Reads the tenant's active row fresh per request (no TTL lag → a publish takes
 *   effect immediately), and FAILS OPEN to the built-in baseline on any DB error
 *   or unparseable row, matching the overlay's "code floor is the safe default".
 */
export async function resolveIntegrationDefinition(
  db: PrismaClient,
  id: string,
  tenantId: string | null,
): Promise<IntegrationDefinition | undefined> {
  const builtIn = REGISTRY[id]
  if (!builtIn) return undefined

  // Platform-scoped keys have no tenant of their own — GLOBAL is all that applies.
  if (!tenantId) {
    await loadRegistryOverlayIfStale(db)
    return getIntegrationDefinition(id)
  }

  try {
    const repo = createIntegrationConfigRepository(db)
    const row = await repo.findActiveForScope(id, tenantId)
    if (!row) return builtIn
    const entry = toOverlayEntry(row.integrationId, row.mapping, row.rules, row.version)
    return entry ? mergeDefinition(builtIn, entry) : builtIn
  } catch (err) {
    logger.warn('integration definition resolve failed — serving built-in baseline', {
      integrationId: id,
      error: err instanceof Error ? err.message : String(err),
    })
    return builtIn
  }
}

export function listIntegrationIds(): string[] {
  return Object.keys(REGISTRY)
}
