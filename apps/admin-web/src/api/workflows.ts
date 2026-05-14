import { adminFetch } from './client'

// ---------------------------------------------------------------------------
// Admin workflow shape (mirrors apps/api/src/handlers/admin/workflows.ts)
// ---------------------------------------------------------------------------

export interface AdminWorkflow {
  id: string
  tenantId: string
  tenantName: string
  tenantSlug: string
  name: string
  version: string
  visibility: 'GLOBAL' | 'TENANT'
  manifest: {
    name: string
    version: string
    entryPoints: string[]
    description?: string
  }
  createdByUserId: string
  createdAt: string
  updatedAt: string
}

export async function listGlobalWorkflows(): Promise<AdminWorkflow[]> {
  return adminFetch<AdminWorkflow[]>('/api/admin/workflows')
}
