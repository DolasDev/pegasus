// ---------------------------------------------------------------------------
// Tenant-wide App Settings — TanStack Query bindings
//
// Mirror of apps/api/src/lib/app-settings.ts. The types are duplicated rather
// than imported to keep the tenant-web build independent of the api package
// (the repo has no shared "client types" package today — every queries module
// declares its DTOs locally; see queries/driver-planning.ts for the same
// pattern).
// ---------------------------------------------------------------------------

import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'

// ---------------------------------------------------------------------------
// Types — must stay in sync with AppSettingsSchema on the API side. Each
// section is an open object so the UI can add new optional fields without
// touching this file in lockstep.
// ---------------------------------------------------------------------------

export type LonghaulClient = 'nwi' | 'qmm'

export interface OperationsSettings {
  longhaulClient?: LonghaulClient | null
}

export interface AppSettings {
  dashboard: Record<string, never> & object
  moves: Record<string, never> & object
  quotes: Record<string, never> & object
  customers: Record<string, never> & object
  dispatch: Record<string, never> & object
  billing: Record<string, never> & object
  operations: OperationsSettings
}

/** Sparse patch — any subset of sections; inside each section every field is
 *  optional. The API rejects unknown section keys (strict), so adding a new
 *  section on the FE without the corresponding API change will fail loudly. */
export type AppSettingsPatch = Partial<{
  dashboard: AppSettings['dashboard']
  moves: AppSettings['moves']
  quotes: AppSettings['quotes']
  customers: AppSettings['customers']
  dispatch: AppSettings['dispatch']
  billing: AppSettings['billing']
  operations: OperationsSettings
}>

// ---------------------------------------------------------------------------
// Query keys + options
// ---------------------------------------------------------------------------

export const appSettingsKeys = {
  all: ['app-settings'] as const,
  detail: () => [...appSettingsKeys.all, 'detail'] as const,
}

// apiFetch already unwraps the `{ data }` envelope from the API — the type
// parameter is the type of `data` itself, not the wrapper. See queries/
// driver-planning.ts for the same convention.
export const appSettingsQueryOptions = queryOptions({
  queryKey: appSettingsKeys.detail(),
  queryFn: () => apiFetch<AppSettings>('/api/v1/settings/app'),
})

// ---------------------------------------------------------------------------
// Mutation — partial update; primes the query cache with the merged response
// so subscribers (any open section page) re-render immediately.
// ---------------------------------------------------------------------------

export function useUpdateAppSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: AppSettingsPatch) =>
      apiFetch<AppSettings>('/api/v1/settings/app', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: (data) => {
      qc.setQueryData(appSettingsKeys.detail(), data)
    },
  })
}
