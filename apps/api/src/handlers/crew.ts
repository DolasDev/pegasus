// ---------------------------------------------------------------------------
// Crew handler — /api/v1/crew
//
// A small read-only surface for the user-administration screen: it feeds the
// "Linked crew member" picker that connects a `driver` login to a CrewMember.
// Gated with `user:list` because it exists solely to support that screen.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { requirePermission } from '../middleware/rbac'
import { Actions } from '../authz/actions'
import type { AppEnv } from '../types'

export const crewHandler = new Hono<AppEnv>()

// ---------------------------------------------------------------------------
// GET /
//
// Lists active crew members for the current tenant. `tenantUserId` is included
// so the picker can show which crew members are already linked to a login.
//
// Response: { data: { id, name, role, tenantUserId }[], meta: { count } }
// ---------------------------------------------------------------------------
crewHandler.get('/', requirePermission(Actions.ListUsers), async (c) => {
  const db = c.get('db')
  const crew = await db.crewMember.findMany({
    where: { isActive: true },
    select: { id: true, name: true, role: true, tenantUserId: true },
    orderBy: { name: 'asc' },
  })
  return c.json({ data: crew, meta: { count: crew.length } })
})
