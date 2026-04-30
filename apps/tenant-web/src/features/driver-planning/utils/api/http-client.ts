// ---------------------------------------------------------------------------
// HTTP client for the longhaul bridge endpoints.
//
// Delegates to tenant-web's `apiFetch`, which sources the base URL from
// `/config.json` and the bearer token from the Cognito session. The legacy
// longhaul code expects a `{ status, data, error }` envelope and never sees a
// throw, so this module re-shapes the result of `apiFetch` accordingly.
// ---------------------------------------------------------------------------

import { apiFetch, ApiError } from '@/api/client'
import { resolveRoute } from './routes'

export async function fetchData(routeName: string, ...args: unknown[]): Promise<unknown> {
  const { method, path, body } = resolveRoute(routeName, args)

  try {
    const data = await apiFetch<unknown>(`/api/v1/longhaul${path}`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    return { status: 200, data, error: undefined }
  } catch (err) {
    if (err instanceof ApiError) {
      return {
        status: err.status,
        data: undefined,
        error: { message: err.message, code: err.code },
      }
    }
    return {
      status: 0,
      data: undefined,
      error: { message: err instanceof Error ? err.message : String(err) },
    }
  }
}
