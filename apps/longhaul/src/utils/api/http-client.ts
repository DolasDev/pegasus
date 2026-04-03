// ---------------------------------------------------------------------------
// HTTP client for the longhaul API
//
// Auth modes:
//   VITE_AUTH_MODE=windows  — injects X-Windows-User header from sessionStorage
//   VITE_AUTH_MODE=api-key  — injects Authorization: Bearer <VITE_LONGHAUL_API_KEY>
// ---------------------------------------------------------------------------

import { resolveRoute } from './routes'

const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001').replace(/\/$/, '')
const AUTH_MODE = import.meta.env.VITE_AUTH_MODE ?? 'api-key'
const API_KEY = import.meta.env.VITE_LONGHAUL_API_KEY ?? ''

export const WINDOWS_USER_KEY = 'longhaul_windows_user'

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (AUTH_MODE === 'windows') {
    const user = sessionStorage.getItem(WINDOWS_USER_KEY)
    if (user) headers['X-Windows-User'] = user
  } else if (API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`
  }
  return headers
}

export async function fetchData(routeName: string, ...args: unknown[]): Promise<unknown> {
  const { method, path, body } = resolveRoute(routeName, args)

  const response = await fetch(`${BASE_URL}/api/v1/longhaul${path}`, {
    method,
    headers: buildHeaders(),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  const json = await response.json()

  return {
    status: response.status,
    data: json.data,
    error: json.error ? { message: json.error } : undefined,
  }
}
