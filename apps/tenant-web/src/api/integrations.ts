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
  createdAt: string
}

export async function getIntegrationConfig(integrationId: string): Promise<IntegrationConfig> {
  return apiFetch<IntegrationConfig>(
    `/api/v1/integrations/${encodeURIComponent(integrationId)}/config`,
  )
}
