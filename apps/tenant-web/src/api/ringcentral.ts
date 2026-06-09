import { apiFetch } from './client'

/**
 * A single RingCentral connection bound to a tenant. One connection per
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

export async function connectRingCentral(input: {
  clientId: string
  clientSecret: string
  jwt: string
  number: string
}): Promise<{ connectionId: string }> {
  return apiFetch<{ connectionId: string }>('/api/v1/integrations/ringcentral/connections', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
