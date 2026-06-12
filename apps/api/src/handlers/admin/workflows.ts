// ---------------------------------------------------------------------------
// Admin workflows handler — /api/admin/workflows
//
// Read-only platform-wide view of every GLOBAL workflow row. Used by the
// admin portal to sanity-check that CI pushes from packages/workflows-stdlib/
// landed correctly. Tenant-scoped (visibility=TENANT) workflows are
// intentionally NOT surfaced here — admins should not casually see what
// individual tenants have uploaded.
//
// Also exposes:
//   GET /api/admin/workflows/runner-status — per-tenant runner health view
//     (runner task status via ECS DescribeTasks + per-tenant execution counts).
//
// Reachable only behind adminAuthMiddleware (applied in admin/index.ts).
// Uses basePrisma directly because admin routes never run inside the tenant
// extension.
// ---------------------------------------------------------------------------

import { DescribeTasksCommand, ECSClient, ListTasksCommand } from '@aws-sdk/client-ecs'
import { Hono } from 'hono'
import type { AdminEnv } from '../../types'
import { db } from '../../db'
import { loadTenantRunnerConfig } from '../../lib/tenant-runner'
import { CURATED_WORKFLOW_NAMES } from '../../lib/curated-workflows'

export const adminWorkflowsRouter = new Hono<AdminEnv>()

const WORKFLOW_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  version: true,
  visibility: true,
  manifest: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const

// ---------------------------------------------------------------------------
// GET /api/admin/workflows
//
// Lists every GLOBAL workflow across the platform, newest first. Includes the
// owning tenant's name/slug so the admin can confirm the upload came from the
// expected platform tenant.
//
// Response: { data: AdminWorkflowRow[], meta: { count } }
// ---------------------------------------------------------------------------
adminWorkflowsRouter.get('/', async (c) => {
  try {
    const rows = await db.workflow.findMany({
      where: { visibility: 'GLOBAL' },
      select: {
        ...WORKFLOW_SELECT,
        tenant: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const data = rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      tenantName: r.tenant.name,
      tenantSlug: r.tenant.slug,
      name: r.name,
      version: r.version,
      visibility: r.visibility,
      manifest: r.manifest,
      createdByUserId: r.createdByUserId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }))

    return c.json({ data, meta: { count: data.length } })
  } catch {
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

// ---------------------------------------------------------------------------
// GET /api/admin/workflows/runner-status
//
// Returns current runner-plane health for the operator:
//
//   runners[] — live ECS task list (tenantId via startedBy, lastStatus,
//               startedAt, taskArn). Only tasks started by a canonical
//               UUID startedBy (i.e. tenant runners, not the stdlib worker)
//               are included.
//
//   tenantQuotas[] — per-tenant execution stats for tenants that have had
//                   TENANT_RUNNER-lane activity today (UTC): today's count
//                   (all statuses) and current concurrent QUEUED/RUNNING count.
//                   Always includes tenants with live runners even if their
//                   count is zero.
//
//   config — whether the runner plane is configured in this environment
//            (TENANT_RUNNER_* env present). Useful for diagnosing "why are
//            there no runners" in dev.
//
// Read-only, no mutations. Not paginated (v1 scale: at most O(tenants) rows).
//
// Response: { data: RunnerStatusResponse }
// ---------------------------------------------------------------------------

/** True for a canonical lowercase UUID — these are the startedBy values set by
 * ensureTenantRunner. */
const TENANT_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function utcDayStart(now: Date): Date {
  const d = new Date(now)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

adminWorkflowsRouter.get('/runner-status', async (c) => {
  const config = loadTenantRunnerConfig()

  type RunnerTask = {
    taskArn: string
    tenantId: string | null
    lastStatus: string
    startedAt: string | null
  }

  let runners: RunnerTask[] = []

  if (config) {
    try {
      const ecsClient = new ECSClient({})
      // List ALL tasks in the cluster with the runner task-definition family.
      // (The stdlib worker uses its own family name, so this scopes to runners.)
      const listed = await ecsClient.send(
        new ListTasksCommand({
          cluster: config.clusterArn,
          family: config.taskDefinition,
          desiredStatus: 'RUNNING',
        }),
      )
      const taskArns = listed.taskArns ?? []
      if (taskArns.length > 0) {
        const described = await ecsClient.send(
          new DescribeTasksCommand({ cluster: config.clusterArn, tasks: taskArns }),
        )
        for (const task of described.tasks ?? []) {
          if (!task.taskArn) continue
          // startedBy is the tenantId (set by ensureTenantRunner). Validate it
          // is UUID-shaped so we only return real runner tasks.
          const startedBy = task.startedBy ?? null
          const tenantId = startedBy && TENANT_ID_REGEX.test(startedBy) ? startedBy : null
          runners.push({
            taskArn: task.taskArn,
            tenantId,
            lastStatus: task.lastStatus ?? 'UNKNOWN',
            startedAt: task.startedAt ? task.startedAt.toISOString() : null,
          })
        }
      }
    } catch {
      // ECS unavailable (dev/unconfigured) — return an empty runners list
      // rather than a 500 so the admin page still loads.
      runners = []
    }
  }

  // Per-tenant execution quota stats. Only TENANT_RUNNER-lane executions count
  // (same filter as the run path: executable=true + name NOT IN curated names).
  // We query all tenants that have any executions today OR have a live runner.
  const now = new Date()
  const dayStart = utcDayStart(now)

  // Tenants with QUEUED/RUNNING tenant-runner executions right now.
  const activeRows = await db.workflowExecution.findMany({
    where: {
      status: { in: ['QUEUED', 'RUNNING'] },
      workflow: {
        executable: true,
        name: { notIn: [...CURATED_WORKFLOW_NAMES] },
      },
    },
    select: { tenantId: true },
  })

  // Tenants with any TENANT_RUNNER executions today.
  const todayRows = await db.workflowExecution.findMany({
    where: {
      createdAt: { gte: dayStart },
      workflow: {
        executable: true,
        name: { notIn: [...CURATED_WORKFLOW_NAMES] },
      },
    },
    select: { tenantId: true },
  })

  // Combine: tenants with runners OR recent activity.
  const runnerTenantIds = new Set(runners.map((r) => r.tenantId).filter(Boolean) as string[])
  const activeTenantIds = new Set(activeRows.map((r) => r.tenantId))
  const todayTenantIds = new Set(todayRows.map((r) => r.tenantId))
  const allTenantIds = new Set([...runnerTenantIds, ...activeTenantIds, ...todayTenantIds])

  // Count per-tenant in-process (no separate DB round-trip per tenant — we
  // already have the rows above).
  const activeCounts = new Map<string, number>()
  for (const row of activeRows) {
    activeCounts.set(row.tenantId, (activeCounts.get(row.tenantId) ?? 0) + 1)
  }
  const todayCounts = new Map<string, number>()
  for (const row of todayRows) {
    todayCounts.set(row.tenantId, (todayCounts.get(row.tenantId) ?? 0) + 1)
  }

  const tenantQuotas = [...allTenantIds].map((tenantId) => ({
    tenantId,
    todayCount: todayCounts.get(tenantId) ?? 0,
    concurrentCount: activeCounts.get(tenantId) ?? 0,
  }))

  return c.json({
    data: {
      configPresent: config !== null,
      runners,
      tenantQuotas,
    },
  })
})
