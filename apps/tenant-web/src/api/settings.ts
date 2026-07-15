import { apiFetch } from './client'

export type MssqlSettings = {
  mssqlConnectionString: string | null
}

export async function getMssqlSettings(): Promise<MssqlSettings> {
  return apiFetch<MssqlSettings>('/api/v1/settings/mssql')
}

export async function updateMssqlSettings(data: {
  mssqlConnectionString: string | null
}): Promise<MssqlSettings> {
  return apiFetch<MssqlSettings>('/api/v1/settings/mssql', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export type MssqlTestCode =
  | 'OK'
  | 'NOT_CONFIGURED'
  | 'CONNECT_TIMEOUT'
  | 'LOGIN_FAILED'
  | 'QUERY_ERROR'
  | 'EXECUTOR_ERROR'

export type MssqlTestResult = {
  ok: boolean
  code: MssqlTestCode
  detail: string
  elapsedMs: number
}

export async function testMssqlConnection(): Promise<MssqlTestResult> {
  return apiFetch<MssqlTestResult>('/api/v1/settings/mssql/test', {
    method: 'POST',
  })
}

// ---------------------------------------------------------------------------
// pegII on-prem API health check — mirrors the MSSQL connection test above.
// The endpoint probes the pegII team's on-prem API over the WireGuard tunnel
// (open GET /health). Always HTTP 200; the verdict is in the body.
// ---------------------------------------------------------------------------

export type PegiiTestCode =
  | 'OK'
  | 'NOT_CONFIGURED'
  | 'PEER_INACTIVE'
  | 'TUNNEL_ERROR'
  | 'HTTP_ERROR'
  | 'BAD_ENVELOPE'

export type PegiiTestResult = {
  ok: boolean
  code: PegiiTestCode
  detail: string
  elapsedMs: number
}

export async function testPegiiConnection(): Promise<PegiiTestResult> {
  return apiFetch<PegiiTestResult>('/api/v1/settings/pegii/test', {
    method: 'POST',
  })
}
