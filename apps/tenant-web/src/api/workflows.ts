import { apiFetch } from './client'

// ---------------------------------------------------------------------------
// Workflow domain types (mirror apps/api/src/handlers/workflows.ts responses)
// ---------------------------------------------------------------------------

export type WorkflowVisibility = 'GLOBAL' | 'TENANT'

export interface WorkflowManifest {
  name: string
  version: string
  entryPoints: string[]
  description?: string
}

export interface Workflow {
  id: string
  tenantId: string
  name: string
  version: string
  visibility: WorkflowVisibility
  manifest: WorkflowManifest
  createdByUserId: string
  createdAt: string
  updatedAt: string
}

export interface WorkflowDownload {
  downloadUrl: string
  expiresInSeconds: number
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export async function listWorkflows(): Promise<Workflow[]> {
  return apiFetch<Workflow[]>('/api/v1/workflows')
}

export async function getWorkflow(id: string): Promise<Workflow> {
  return apiFetch<Workflow>(`/api/v1/workflows/${id}`)
}

export async function getWorkflowDownloadUrl(id: string): Promise<WorkflowDownload> {
  return apiFetch<WorkflowDownload>(`/api/v1/workflows/${id}/download-url`)
}
