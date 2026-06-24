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
