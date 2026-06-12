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

// ---------------------------------------------------------------------------
// Runner status (Phase 3 Unit 11)
// ---------------------------------------------------------------------------

export interface RunnerTask {
  taskArn: string
  /** Tenant id this runner belongs to (from ECS startedBy). Null if unknown. */
  tenantId: string | null
  lastStatus: string
  startedAt: string | null
}

export interface TenantQuota {
  tenantId: string
  /** TENANT_RUNNER-lane executions started today (UTC, all statuses). */
  todayCount: number
  /** TENANT_RUNNER-lane executions currently QUEUED or RUNNING. */
  concurrentCount: number
}

export interface RunnerStatusResponse {
  /** True if the TENANT_RUNNER_* env vars are configured in this env. */
  configPresent: boolean
  /** Current ECS runner tasks (RUNNING or provisioning toward RUNNING). */
  runners: RunnerTask[]
  /** Per-tenant execution quota stats for tenants with recent activity. */
  tenantQuotas: TenantQuota[]
}

export async function getRunnerStatus(): Promise<RunnerStatusResponse> {
  return adminFetch<RunnerStatusResponse>('/api/admin/workflows/runner-status')
}
