// ---------------------------------------------------------------------------
// HTTP client for the admin API's /api/vpn/** surface.
//
// Uses built-in fetch (Node 20+). Sends the ApiClient plain key as a Bearer
// token. Caches the last seen ETag so steady-state polls are cheap 304s.
// ---------------------------------------------------------------------------

import type { DesiredPeer } from './reconciler'

export interface AgentApiConfig {
  /** Base URL of the admin API, e.g. https://api.pegasusapp.com */
  baseUrl: string
  /** ApiClient plain key — `vnd_<48 hex>`. */
  apiKey: string
  /** Optional fetch impl (tests pass a stub). Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch
}

export interface PeerFeedResponse {
  /** Null when the server returned 304 — caller keeps previous desired state. */
  peers: DesiredPeer[] | null
  generation: number | null
  etag: string | null
}

export interface AgentApi {
  getPeers(ifNoneMatch: string | null): Promise<PeerFeedResponse>
  patchPeer(
    id: string,
    body: {
      status?: 'PENDING' | 'ACTIVE'
      lastHandshakeAt?: string | null
      rxBytes?: string
      txBytes?: string
    },
  ): Promise<void>
}

interface ApiPeerDto {
  id: string
  tenantId: string
  assignedIp: string
  publicKey: string
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED'
}

export function createAgentApi(config: AgentApiConfig): AgentApi {
  const doFetch = config.fetchImpl ?? globalThis.fetch

  function authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    }
  }

  return {
    async getPeers(ifNoneMatch: string | null): Promise<PeerFeedResponse> {
      const headers: Record<string, string> = { ...authHeaders() }
      if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch

      const res = await doFetch(`${config.baseUrl}/api/vpn/peers`, { headers })
      if (res.status === 304) {
        return { peers: null, generation: null, etag: res.headers.get('etag') }
      }
      if (!res.ok) {
        throw new Error(`GET /api/vpn/peers failed: ${res.status} ${res.statusText}`)
      }
      const body = (await res.json()) as {
        data: ApiPeerDto[]
        meta: { generation: number }
      }
      const peers: DesiredPeer[] = body.data.map((p) => ({
        id: p.id,
        tenantId: p.tenantId,
        publicKey: p.publicKey,
        allowedIps: `${p.assignedIp}/32`,
        status: p.status,
      }))
      return {
        peers,
        generation: body.meta.generation,
        etag: res.headers.get('etag'),
      }
    },

    async patchPeer(id, body): Promise<void> {
      const res = await doFetch(`${config.baseUrl}/api/vpn/peers/${id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        throw new Error(`PATCH /api/vpn/peers/${id} failed: ${res.status} ${res.statusText}`)
      }
    },
  }
}
