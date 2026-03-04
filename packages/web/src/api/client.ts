import { getConfig } from '../config'
import { getSession } from '../auth/session'

type SuccessEnvelope<T> = { data: T }
type ErrorEnvelope = { error: string; code: string }
type ApiEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Typed fetch wrapper. Unwraps `{ data }` envelopes and throws `ApiError` on
 * error responses. All calls go through here so the base URL and headers are
 * applied consistently.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const session = getSession()
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  headers.set('x-correlation-id', crypto.randomUUID())

  if (session?.token) {
    headers.set('Authorization', `Bearer ${session.token}`)
  }

  const res = await fetch(`${getConfig().apiUrl}${path}`, {
    ...init,
    headers,
  })

  // 204 No Content — no body to parse.
  if (res.status === 204) return null as T

  const json = (await res.json()) as ApiEnvelope<T>

  if ('error' in json) {
    throw new ApiError(json.error, json.code, res.status)
  }

  return json.data
}
