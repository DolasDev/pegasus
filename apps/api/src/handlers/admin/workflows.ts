// ---------------------------------------------------------------------------
// Admin workflows handler — /api/admin/workflows
//
// Read-only platform-wide view of every GLOBAL workflow row. Used by the
// admin portal to sanity-check that CI pushes from packages/workflows-stdlib/
// landed correctly. Tenant-scoped (visibility=TENANT) workflows are
// intentionally NOT surfaced here — admins should not casually see what
// individual tenants have uploaded.
//
// Reachable only behind adminAuthMiddleware (applied in admin/index.ts).
// Uses basePrisma directly because admin routes never run inside the tenant
// extension.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { AdminEnv } from '../../types'
import { db } from '../../db'

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
