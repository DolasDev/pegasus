// ---------------------------------------------------------------------------
// Integrations list handler — GET /api/v1/integrations
//
// Read-only, tenant-session surface for the Developer settings "Integrations"
// card. Lists the integrations the platform validates inbound orders against —
// the integration-validator registry (weichert, …) — joined with each
// integration's active published config (version + visibility) for the caller's
// tenant, when one exists.
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
import { listIntegrationIds, getIntegrationDefinition } from '../../integration-validation/registry'
import { createIntegrationConfigRepository } from '../../repositories/integration-config.repository'

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

export const integrationsHandler = new Hono<AppEnv>()

integrationsHandler.get('/', requirePermission(Actions.ReadIntegrationConfig), async (c) => {
  const tenantId = c.get('tenantId')
  if (!tenantId) throw new DomainError('Tenant context required', 'UNAUTHENTICATED')
  const repo = createIntegrationConfigRepository(c.get('db'))

  const data: IntegrationSummary[] = []
  for (const id of listIntegrationIds()) {
    const def = getIntegrationDefinition(id)
    if (!def) continue
    const active = await repo.findActiveForScope(id, tenantId)
    data.push({
      id: def.id,
      name: def.displayName,
      description: def.description,
      published: active !== null,
      version: active?.version ?? null,
      visibility: active?.visibility ?? null,
    })
  }
  return c.json({ data })
})
