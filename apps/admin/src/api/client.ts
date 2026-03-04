import { getAccessToken } from '@/auth/cognito'
import { getConfig } from '@/config'

type SuccessEnvelope<T> = { data: T }
type ErrorEnvelope = { error: string; code: string }
type ApiEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope

export interface PaginationMeta {
  total: number
  count: number
  limit: number
  offset: number
}

type PaginatedEnvelope<T> = { data: T; meta: PaginationMeta }

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
 * Typed fetch wrapper for the admin API. Attaches the Cognito access token as
 * a Bearer token and unwraps `{ data }` envelopes. Throws `ApiError` on error
 * responses so TanStack Query can surface them correctly.
 */
export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken()

  const res = await fetch(`${getConfig().apiUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'x-correlation-id': crypto.randomUUID(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

/**
 * Like `adminFetch` but for paginated list endpoints that return
 * `{ data: T[], meta: PaginationMeta }` at the top level (not nested).
 */
export async function adminFetchPaginated<T>(
  path: string,
  init?: RequestInit,
): Promise<{ data: T[]; meta: PaginationMeta }> {
  const token = getAccessToken()

  const res = await fetch(`${getConfig().apiUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'x-correlation-id': crypto.randomUUID(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    ...init,
  })

  const json = (await res.json()) as PaginatedEnvelope<T[]> | ErrorEnvelope

  if ('error' in json) {
    throw new ApiError(json.error, json.code, res.status)
  }

  return json
}
