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

/**
 * Typed fetch wrapper. Unwraps `{ data }` envelopes and throws `ApiError` on
 * error responses. All calls go through here so the base URL and headers are
 * applied consistently.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
  })

  const json = (await res.json()) as ApiEnvelope<T>

  if ('error' in json) {
    throw new ApiError(json.error, json.code, res.status)
  }

  return json.data
}
