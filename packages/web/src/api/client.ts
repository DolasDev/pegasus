/// <reference types="vite/client" />

/** Base URL from Vite env — falls back to localhost:3000 for local dev. */
const BASE_URL = (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:3000'

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

import { getSession } from '../auth/session'

/**
 * Typed fetch wrapper. Unwraps `{ data }` envelopes and throws `ApiError` on
 * error responses. All calls go through here so the base URL and headers are
 * applied consistently.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const session = getSession()
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')

  if (session?.token) {
    headers.set('Authorization', `Bearer ${session.token}`)
  }

  const res = await fetch(`${BASE_URL}${path}`, {
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
