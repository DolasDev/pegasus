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
