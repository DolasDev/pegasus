import { apiFetch } from './client'

// ---------------------------------------------------------------------------
// Integrations — mirror apps/api/src/handlers/integrations/list.ts.
//
// Read-only list of the integration-validator integrations the platform checks
// inbound orders against, with each one's active published-config status for
// the caller's tenant.
//
// Two pages read this one list and slice it differently:
//   - /integrations               → only rows with `published: true` (what is
//                                   live for this tenant right now)
//   - /settings/developer/integrations → every row, grouped by `visibility` /
//                                   `published` into platform / built-in / own
// A forked id resolves to the tenant's OWN row (the API prefers own over
// GLOBAL), so it appears exactly once, under "your integrations".
// ---------------------------------------------------------------------------

export interface IntegrationSummary {
  id: string
  name: string
  description: string
  /** True when an active published config exists for the caller's scope. */
  published: boolean
  /** Active config version, or null when only the built-in baseline applies. */
  version: number | null
  /** Active config visibility, or null when unpublished. */
  visibility: 'GLOBAL' | 'TENANT' | null
}

export async function listIntegrations(): Promise<IntegrationSummary[]> {
  // apiFetch unwraps the `{ data }` envelope.
  return apiFetch<IntegrationSummary[]>('/api/v1/integrations')
}

// ---------------------------------------------------------------------------
// Integration floors — the per-TYPE fact abstraction every integration is built
// on (canonical shape, legal mapping targets, fact catalog). Floors are CODE,
// not data: they cannot be published, forked, or deleted, so this is a
// reference view only. Mirrors GET /integrations/floors in
// apps/api/src/handlers/integration-validation/validate.ts.
// ---------------------------------------------------------------------------

export interface IntegrationFloor {
  /** Floor id, e.g. "shipment_status_update". */
  floor: string
  /** Legal mapping TARGET paths; array elements are marked with `[]`. */
  canonicalFields: string[]
  /** Legal rule facts: name → type. */
  factCatalog: Record<string, 'string' | 'number' | 'boolean'>
  /** One-line semantics per fact, when the floor documents them. */
  factDocs?: Record<string, string>
  /** Legal mapping SOURCE roots. Absent on partner-neutral floors. */
  inputFieldRoots?: string[]
  defaultAction: string
  /** Projection target, when the floor caches external state. */
  projection?: { entityType: string }
}

export async function listIntegrationFloors(): Promise<IntegrationFloor[]> {
  return apiFetch<IntegrationFloor[]>('/api/v1/integrations/floors')
}

// ---------------------------------------------------------------------------
// Required secrets/configs — which keys each integration reads at runtime, each
// resolved present/missing against the tenant's store (presence only, no values).
// Mirrors the workflow requirements-summary; same resolved-requirement shape.
// ---------------------------------------------------------------------------

/** A declared requirement resolved against the tenant's store (presence only). */
export interface ResolvedRequirement {
  kind: 'SECRET' | 'CONFIG'
  key: string
  group: string
  description: string | null
  present: boolean
}

/** One integration's resolved requirements in the summary. */
export interface IntegrationRequirements {
  integrationId: string
  displayName: string
  requirements: ResolvedRequirement[]
  missingCount: number
}

/** Response of GET /api/v1/integrations/requirements-summary. */
export interface IntegrationRequirementsSummary {
  integrations: IntegrationRequirements[]
  totalMissing: number
}

export async function getIntegrationRequirementsSummary(): Promise<IntegrationRequirementsSummary> {
  return apiFetch<IntegrationRequirementsSummary>('/api/v1/integrations/requirements-summary')
}

// ---------------------------------------------------------------------------
// Active config (mapping + rules + corpus) for a single integration.
//
// Mirrors the `toFull` projection in
// apps/api/src/handlers/integration-validation/config.ts (gateReport excluded).
// The GET endpoint lives on the dual-auth m2m plane but accepts a Cognito
// session, so the SPA can read it directly. ReadIntegrationConfig is granted to
// every authenticated tenant user, so this powers an all-user Integrations page.
// ---------------------------------------------------------------------------

/** Scalar a `$map` may translate a value to. Mirrors MapScalar on the API. */
export type MapScalar = string | number | boolean | null

/** A directive leaf in the output-shaped mapping (mirrors MappingDirective). */
export interface MappingDirective {
  $from: string | string[]
  default?: unknown
  $map?: Record<string, MapScalar>
  coerce?: string
  $each?: MappingObject
}

/** A node in the mapping tree: source-path string, directive, or nested object. */
export type MappingNode = string | MappingDirective | MappingObject
export interface MappingObject {
  [field: string]: MappingNode
}

/** A predicate within a rule's `when` clause (mirrors Predicate on the API). */
export interface Predicate {
  fact: string
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'
  value: string | number | boolean | null | (string | number | boolean)[]
}

/** A single validation rule (mirrors Rule on the API). */
export interface IntegrationRule {
  id: string
  description: string
  field: string
  message: string
  sourceRef?: string
  when: Predicate[]
}

export interface IntegrationConfig {
  id: string
  integrationId: string
  version: number
  visibility: 'GLOBAL' | 'TENANT'
  status: 'PUBLISHED' | 'SUPERSEDED'
  /** Output-shaped mapping template (recursive). */
  mapping: MappingObject
  /** Decision-table rules. */
  rules: IntegrationRule[]
  /** Golden-corpus cases — surfaced only in the raw-JSON view. */
  corpus: unknown[]
  /**
   * The published inbound-ingress block ({ eventType, dedupKeyPath, validation,
   * ackTemplate }), or absent when the integration is not inbound-capable. Gates
   * the Ingress tab and seeds its dry-run sample.
   */
  inbound?: Record<string, unknown>
  publishedBy: string
  /** Source config id when this row was forked from a GLOBAL platform config. */
  forkedFromConfigId: string | null
  /** Source config version at fork time. */
  forkedFromVersion: number | null
  createdAt: string
}

export async function getIntegrationConfig(integrationId: string): Promise<IntegrationConfig> {
  return apiFetch<IntegrationConfig>(
    `/api/v1/integrations/${encodeURIComponent(integrationId)}/config`,
  )
}

// ---------------------------------------------------------------------------
// Mutations — fork / validate / publish / versions / rollback.
//
// All live on the dual-auth m2m plane and accept a Cognito session, gated by
// PublishIntegrationConfig + the INTEGRATION_CONFIG_PUBLISH_ENABLED flag.
// Mirror apps/api/src/handlers/integration-validation/config.ts.
// ---------------------------------------------------------------------------

/**
 * Fork the platform (GLOBAL) config for an integration into the caller's tenant
 * scope — copies its mapping/rules/corpus, re-runs the gate, and publishes it as
 * the tenant's own TENANT config (v1). Returns the new config row.
 */
export async function forkIntegrationConfig(integrationId: string): Promise<IntegrationConfig> {
  return apiFetch<IntegrationConfig>(
    `/api/v1/integrations/${encodeURIComponent(integrationId)}/config/fork`,
    { method: 'POST' },
  )
}

/** What a delete removed, echoed back by the API. */
export interface DeleteConfigResult {
  integrationId: string
  /** Which scope was deleted — TENANT for a tenant caller, GLOBAL for platform. */
  visibility: 'GLOBAL' | 'TENANT'
  /** How many rows (all versions) the delete removed. */
  deleted: number
}

/**
 * Delete the caller's ENTIRE config lineage for an integration — every version,
 * not just the active one. Scoped server-side by who is asking: a tenant deletes
 * its own TENANT overlay and immediately re-inherits the platform (GLOBAL) config
 * or the built-in code baseline; the platform tenant deletes the GLOBAL config.
 *
 * `force` only matters for a GLOBAL delete, where other tenants' overlays cause a
 * 409 `DEPENDENTS_EXIST` first; it acknowledges those overlays and never touches
 * them. A tenant deleting its own overlay never needs it.
 */
export async function deleteIntegrationConfig(
  integrationId: string,
  opts?: { force?: boolean },
): Promise<DeleteConfigResult> {
  const query = opts?.force ? '?force=true' : ''
  return apiFetch<DeleteConfigResult>(
    `/api/v1/integrations/${encodeURIComponent(integrationId)}/config${query}`,
    { method: 'DELETE' },
  )
}

/** One problem the gate found in a candidate config. */
export interface GateProblem {
  stage: string
  where: string
  problem: string
}

/** The deterministic gate report (mirrors GateReport on the API). */
export interface GateReport {
  ok: boolean
  problems: GateProblem[]
  corpus: { total: number; passed: number; failures: unknown[] }
}

/** The editable surface a tenant submits to validate/publish. */
export interface ConfigDraft {
  mapping: unknown
  rules: unknown
  corpus: unknown[]
}

/** Dry-run the gate against a candidate config without writing. */
export async function validateIntegrationConfig(
  integrationId: string,
  draft: ConfigDraft,
): Promise<GateReport> {
  return apiFetch<GateReport>(
    `/api/v1/integrations/${encodeURIComponent(integrationId)}/config/validate`,
    { method: 'POST', body: JSON.stringify(draft) },
  )
}

/** Publish a new version of the tenant's own config (gated server-side). */
export async function publishIntegrationConfig(
  integrationId: string,
  draft: ConfigDraft,
): Promise<IntegrationConfig> {
  return apiFetch<IntegrationConfig>(
    `/api/v1/integrations/${encodeURIComponent(integrationId)}/config`,
    { method: 'POST', body: JSON.stringify(draft) },
  )
}

/** A compact version-history entry (mirrors the `toSummary` projection). */
export interface IntegrationConfigVersion {
  id: string
  integrationId: string
  version: number
  visibility: 'GLOBAL' | 'TENANT'
  status: 'PUBLISHED' | 'SUPERSEDED'
  publishedBy: string
  forkedFromConfigId: string | null
  forkedFromVersion: number | null
  createdAt: string
}

/** Version history for the caller's scope, newest first. */
export async function listIntegrationConfigVersions(
  integrationId: string,
): Promise<IntegrationConfigVersion[]> {
  return apiFetch<IntegrationConfigVersion[]>(
    `/api/v1/integrations/${encodeURIComponent(integrationId)}/config/versions`,
  )
}

/** Re-publish a prior version as a new version (re-runs the gate). */
export async function rollbackIntegrationConfig(
  integrationId: string,
  version: number,
): Promise<IntegrationConfig> {
  return apiFetch<IntegrationConfig>(
    `/api/v1/integrations/${encodeURIComponent(integrationId)}/config/rollback/${version}`,
    { method: 'POST' },
  )
}
