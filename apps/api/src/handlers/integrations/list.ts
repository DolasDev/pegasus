// ---------------------------------------------------------------------------
// Integrations list handler — GET /api/v1/integrations
//
// Read-only, tenant-session surface for the Developer settings "Integrations"
// card. Lists the integrations that apply to the caller's tenant — built-in code
// overlays, GLOBAL platform configs, and the tenant's own published configs —
// joined with each integration's active config (version + visibility) for that
// tenant, when one exists. The id set + resolution live in
// `integration-validation/summaries`, shared with the m2m discovery endpoints.
//
// RBAC: ReadIntegrationConfig (tenant_admin covers it via permit-everything).
// This is the session-plane sibling of the M2M `integrationConfig` handler; it
// exposes no mapping/rules detail and never mutates.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { DomainError } from '@pegasus/domain'
import { requirePermission } from '../../middleware/rbac'
import { Actions } from '../../authz/actions'
import type { AppEnv } from '../../types'
import { listIntegrationSummaries } from '../../integration-validation/summaries'

export type { IntegrationSummary } from '../../integration-validation/summaries'

export const integrationsHandler = new Hono<AppEnv>()

integrationsHandler.get('/', requirePermission(Actions.ReadIntegrationConfig), async (c) => {
  const tenantId = c.get('tenantId')
  if (!tenantId) throw new DomainError('Tenant context required', 'UNAUTHENTICATED')
  return c.json({ data: await listIntegrationSummaries(c.get('db'), tenantId) })
})
