import { apiFetch } from './client'

// ---------------------------------------------------------------------------
// Integrations — mirror apps/api/src/handlers/integrations/list.ts.
//
// Read-only list of the integration-validator integrations the platform checks
// inbound orders against, with each one's active published-config status for
// the caller's tenant. Powers the Developer page's "Integrations" card.
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
