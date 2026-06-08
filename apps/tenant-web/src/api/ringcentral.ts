import { apiFetch } from './client'

/**
 * A single RingCentral OAuth connection bound to a tenant. One connection per
 * RingCentral extension (owner number). `tokenStatus`/`health` drive the badge
 * shown on the integration settings page.
 */
export type RcConnection = {
  id: string
  ownerNumber: string
  rcAccountId: string
  rcExtensionId: string
  tokenStatus: 'ACTIVE' | 'EXPIRED'
  health: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'
  lastRefreshedAt: string | null
  scopes: string[]
  createdAt: string
}

export async function listRingCentralConnections(): Promise<{ connections: RcConnection[] }> {
  return apiFetch<{ connections: RcConnection[] }>('/api/v1/integrations/ringcentral/connections')
}

export async function disconnectRingCentralConnection(
  id: string,
): Promise<{ disconnected: boolean }> {
  return apiFetch<{ disconnected: boolean }>(`/api/v1/integrations/ringcentral/connections/${id}`, {
    method: 'DELETE',
  })
}

export async function startRingCentralConnect(number: string): Promise<{ url: string }> {
  return apiFetch<{ url: string }>(
    `/api/v1/integrations/ringcentral/oauth/start?number=${encodeURIComponent(number)}`,
  )
}
