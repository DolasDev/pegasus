import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getMssqlSettings,
  updateMssqlSettings,
  testMssqlConnection,
  testPegiiConnection,
} from '@/api/settings'

export const settingsKeys = {
  all: ['settings'] as const,
  mssql: () => [...settingsKeys.all, 'mssql'] as const,
}

export const mssqlSettingsQueryOptions = queryOptions({
  queryKey: settingsKeys.mssql(),
  queryFn: () => getMssqlSettings(),
})

export function useUpdateMssqlSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { mssqlConnectionString: string | null }) => updateMssqlSettings(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settingsKeys.mssql() })
    },
  })
}

export function useTestMssqlConnection() {
  return useMutation({
    mutationFn: () => testMssqlConnection(),
  })
}

export function useTestPegiiConnection() {
  return useMutation({
    mutationFn: () => testPegiiConnection(),
  })
}
