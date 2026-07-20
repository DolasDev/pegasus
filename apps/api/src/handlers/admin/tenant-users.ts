// ---------------------------------------------------------------------------
// Admin tenant-user management handler — /api/admin/tenants/:tenantId/users/**
//
// Lets platform administrators view, invite, update role, deactivate, and
// reactivate users belonging to any tenant. Uses the base Prisma singleton
// (not the tenant-scoped extension) and bypasses tenant RBAC.
//
// Endpoints:
//   GET    /                       — list all TenantUsers for the tenant
//   POST   /                       — invite a new user
//   PATCH  /:userId                — update role (ADMIN ↔ USER)
//   POST   /:userId/reactivate     — reactivate a deactivated user
//   DELETE /:userId                — deactivate user
//
// Deactivate/reactivate touch ONLY the target tenant's TenantUser row — see
// handlers/users.ts's file header for why this must never call a Cognito
// Admin*User command (one shared user pool across every tenant on the
// platform; TenantUser.status, enforced by cognito/pre-token.ts at
// token-issuance time, is the real per-tenant gate).
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import type { AdminEnv } from '../../types'
import { db } from '../../db'
import { ROLE_OPTIONS } from '../../authz/role-options'
import { createUsersRepository, type TenantUserRow } from '../../repositories/users'
import { provisionCognitoUser } from './cognito'
import { writeAuditLog } from './audit'
import { logger } from '../../lib/logger'

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const InviteUserBody = z.object({
  // Normalize to a canonical lowercase form so the Cognito username (created
  // here) matches what the user sees in the UI and types at login. Cognito
  // usernames are case-sensitive, so a mixed-case invite would otherwise lock
  // the user out — they'd log in with the lowercased address they see.
  email: z.string().trim().email().toLowerCase(),
  /** Cedar role-group memberships. Defaults to ['viewer'] for the read-only
   *  baseline persona. Viewer is only ever granted by explicit assignment —
   *  no implicit role assignment when roleNames is empty (Cedar denies). */
  roleNames: z.array(z.string().min(1)).default(['viewer']),
})

const PatchUserBody = z
  .object({
    roleNames: z.array(z.string().min(1)).optional(),
    legacyWindowsUsername: z.string().min(1).max(255).nullable().optional(),
  })
  .refine((d) => d.roleNames !== undefined || d.legacyWindowsUsername !== undefined, {
    message: 'At least one of roleNames or legacyWindowsUsername must be provided',
  })

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

type TenantUserResponse = {
  id: string
  email: string
  cognitoSub: string | null
  legacyWindowsUsername: string | null
  /** Cedar role-group memberships — authoritative source for permission gating. */
  roleNames: string[]
  /** Coarse-grained role string derived from `roleNames` for display. */
  role: 'ADMIN' | 'USER'
  status: 'PENDING' | 'ACTIVE' | 'DEACTIVATED'
  invitedAt: string
  activatedAt: string | null
  deactivatedAt: string | null
}

function deriveLegacyRole(roleNames: readonly string[]): 'ADMIN' | 'USER' {
  return roleNames.includes('tenant_admin') ? 'ADMIN' : 'USER'
}

function toResponse(row: TenantUserRow): TenantUserResponse {
  return {
    id: row.id,
    email: row.email,
    cognitoSub: row.cognitoSub,
    legacyWindowsUsername: row.legacyWindowsUsername,
    roleNames: row.roleNames,
    role: deriveLegacyRole(row.roleNames),
    status: row.status,
    invitedAt: row.invitedAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const adminTenantUsersRouter = new Hono<AdminEnv>()

// ---------------------------------------------------------------------------
// GET /role-options
//
// Pass-through to the canonical role-name catalog. No tenant lookup — the
// catalog is platform-wide. adminAuthMiddleware on the parent router gates
// this endpoint.
// ---------------------------------------------------------------------------
adminTenantUsersRouter.get('/role-options', (c) => {
  return c.json({ data: ROLE_OPTIONS })
})

// ---------------------------------------------------------------------------
// GET /
//
// Lists all TenantUsers for the given tenant.
//
// Response: { data: TenantUserResponse[], meta: { count } }
// ---------------------------------------------------------------------------
adminTenantUsersRouter.get('/', async (c) => {
  const tenantId = c.req.param('tenantId')!

  try {
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })
    if (!tenant) {
      return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
    }

    const repo = createUsersRepository(db as PrismaClient)
    const users = await repo.listByTenant(tenantId)
    return c.json({ data: users.map(toResponse), meta: { count: users.length } })
  } catch (err) {
    logger.error('GET admin/tenants/:tenantId/users: failed', { error: String(err), tenantId })
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

// ---------------------------------------------------------------------------
// POST /
//
// Invites a new user to the tenant:
//   1. Validate body
//   2. Check tenant exists
//   3. Check email not already in roster (409 CONFLICT)
//   4. Provision Cognito user (idempotent on UsernameExistsException)
//   5. Create TenantUser record (PENDING) + audit log in transaction
//
// Response: { data: TenantUserResponse } (201)
// ---------------------------------------------------------------------------
adminTenantUsersRouter.post(
  '/',
  validator('json', (value, c) => {
    const r = InviteUserBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.req.param('tenantId')!
    const body = c.req.valid('json')
    const adminSub = c.get('adminSub')
    const adminEmail = c.get('adminEmail')
    const ipAddress = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip')
    const userAgent = c.req.header('user-agent')

    let tenantContext: { name: string; slug: string }
    try {
      const tenant = await db.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, slug: true },
      })
      if (!tenant) {
        return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
      }
      tenantContext = { name: tenant.name, slug: tenant.slug }
    } catch (err) {
      logger.error('POST admin/tenants/:tenantId/users: tenant lookup failed', {
        error: String(err),
        tenantId,
      })
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }

    const repo = createUsersRepository(db as PrismaClient)

    const existing = await repo.findByEmail(body.email, tenantId)
    if (existing) {
      return c.json(
        {
          error: `User with email "${body.email}" is already invited to this tenant`,
          code: 'CONFLICT',
        },
        409,
      )
    }

    try {
      await provisionCognitoUser(body.email, {
        tenantId,
        tenantName: tenantContext.name,
        tenantSlug: tenantContext.slug,
      })
    } catch (err) {
      logger.error('POST admin/tenants/:tenantId/users: Cognito AdminCreateUser failed', {
        error: String(err),
        email: body.email,
      })
      return c.json(
        { error: 'Failed to create the user account. Please try again.', code: 'COGNITO_ERROR' },
        500,
      )
    }

    try {
      const user = await db.$transaction(async (tx) => {
        const txRepo = createUsersRepository(tx as PrismaClient)
        const created = await txRepo.invite(tenantId, body.email, body.roleNames)
        await writeAuditLog(
          tx as Prisma.TransactionClient,
          adminSub,
          adminEmail,
          'ADMIN_INVITE_TENANT_USER',
          'TENANT_USER',
          created.id,
          null,
          { tenantId, email: body.email, roleNames: body.roleNames },
          ipAddress,
          userAgent,
        )
        return created
      })

      return c.json({ data: toResponse(user) }, 201)
    } catch (err) {
      logger.error('POST admin/tenants/:tenantId/users: failed to create TenantUser', {
        error: String(err),
        email: body.email,
        tenantId,
      })
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

// ---------------------------------------------------------------------------
// PATCH /:userId
//
// Updates the role of a TenantUser.
//
// Response: { data: TenantUserResponse } (200)
// ---------------------------------------------------------------------------
adminTenantUsersRouter.patch(
  '/:userId',
  validator('json', (value, c) => {
    const r = PatchUserBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.req.param('tenantId')!
    const userId = c.req.param('userId')!
    const { roleNames, legacyWindowsUsername } = c.req.valid('json')
    const adminSub = c.get('adminSub')
    const adminEmail = c.get('adminEmail')
    const ipAddress = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip')
    const userAgent = c.req.header('user-agent')

    const repo = createUsersRepository(db as PrismaClient)

    const existing = await repo.findById(userId, tenantId)
    if (!existing) {
      return c.json({ error: 'User not found', code: 'NOT_FOUND' }, 404)
    }

    try {
      const updated = await db.$transaction(async (tx) => {
        const txRepo = createUsersRepository(tx as PrismaClient)
        let current = existing
        if (roleNames !== undefined) {
          current = await txRepo.updateRoleNames(userId, roleNames)
          await writeAuditLog(
            tx as Prisma.TransactionClient,
            adminSub,
            adminEmail,
            'ADMIN_UPDATE_TENANT_USER_ROLE',
            'TENANT_USER',
            userId,
            { roleNames: existing.roleNames },
            { roleNames },
            ipAddress,
            userAgent,
          )
        }
        if (legacyWindowsUsername !== undefined) {
          current = await txRepo.updateLegacyWindowsUsername(userId, legacyWindowsUsername)
          await writeAuditLog(
            tx as Prisma.TransactionClient,
            adminSub,
            adminEmail,
            'ADMIN_UPDATE_TENANT_USER_LEGACY_WINDOWS_USERNAME',
            'TENANT_USER',
            userId,
            { legacyWindowsUsername: existing.legacyWindowsUsername },
            { legacyWindowsUsername },
            ipAddress,
            userAgent,
          )
        }
        return current
      })

      return c.json({ data: toResponse(updated) })
    } catch (err) {
      logger.error('PATCH admin/tenants/:tenantId/users/:userId: failed', {
        error: String(err),
        userId,
        tenantId,
      })
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

// ---------------------------------------------------------------------------
// POST /:userId/reactivate
//
// Reactivates a deactivated TenantUser, scoped to this tenant only:
//   1. Guard against reactivating a non-deactivated user (422 INVALID_STATE)
//   2. Set TenantUser status=ACTIVE, clear deactivatedAt + audit log in transaction
//
// Response: { data: TenantUserResponse } (200)
// ---------------------------------------------------------------------------
adminTenantUsersRouter.post('/:userId/reactivate', async (c) => {
  const tenantId = c.req.param('tenantId')!
  const userId = c.req.param('userId')!
  const adminSub = c.get('adminSub')
  const adminEmail = c.get('adminEmail')
  const ipAddress = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip')
  const userAgent = c.req.header('user-agent')

  const repo = createUsersRepository(db as PrismaClient)

  const existing = await repo.findById(userId, tenantId)
  if (!existing) {
    return c.json({ error: 'User not found', code: 'NOT_FOUND' }, 404)
  }

  if (existing.status !== 'DEACTIVATED') {
    return c.json({ error: 'User is not deactivated', code: 'INVALID_STATE' }, 422)
  }

  try {
    const reactivated = await db.$transaction(async (tx) => {
      const txRepo = createUsersRepository(tx as PrismaClient)
      const u = await txRepo.reactivate(userId)
      await writeAuditLog(
        tx as Prisma.TransactionClient,
        adminSub,
        adminEmail,
        'ADMIN_REACTIVATE_TENANT_USER',
        'TENANT_USER',
        userId,
        { status: existing.status, email: existing.email },
        { status: 'ACTIVE' },
        ipAddress,
        userAgent,
      )
      return u
    })

    return c.json({ data: toResponse(reactivated) })
  } catch (err) {
    logger.error('POST admin/tenants/:tenantId/users/:userId/reactivate: failed to reactivate', {
      error: String(err),
      userId,
      tenantId,
    })
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

// ---------------------------------------------------------------------------
// DELETE /:userId
//
// Deactivates a TenantUser, scoped to this tenant only:
//   1. Guard against deactivating an already-deactivated user (422 INVALID_STATE)
//   2. Guard against deactivating the last active admin (422 LAST_ADMIN)
//   3. Set TenantUser status=DEACTIVATED + audit log in transaction
//
// Response: { data: TenantUserResponse } (200)
// ---------------------------------------------------------------------------
adminTenantUsersRouter.delete('/:userId', async (c) => {
  const tenantId = c.req.param('tenantId')!
  const userId = c.req.param('userId')!
  const adminSub = c.get('adminSub')
  const adminEmail = c.get('adminEmail')
  const ipAddress = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip')
  const userAgent = c.req.header('user-agent')

  const repo = createUsersRepository(db as PrismaClient)

  const existing = await repo.findById(userId, tenantId)
  if (!existing) {
    return c.json({ error: 'User not found', code: 'NOT_FOUND' }, 404)
  }

  if (existing.status === 'DEACTIVATED') {
    return c.json({ error: 'User is already deactivated', code: 'INVALID_STATE' }, 422)
  }

  if (existing.roleNames.includes('tenant_admin')) {
    const adminCount = await repo.countAdmins(tenantId)
    if (adminCount <= 1) {
      return c.json(
        {
          error: 'Cannot deactivate the last administrator. Promote another user to admin first.',
          code: 'LAST_ADMIN',
        },
        422,
      )
    }
  }

  try {
    const deactivated = await db.$transaction(async (tx) => {
      const txRepo = createUsersRepository(tx as PrismaClient)
      const u = await txRepo.deactivate(userId)
      await writeAuditLog(
        tx as Prisma.TransactionClient,
        adminSub,
        adminEmail,
        'ADMIN_DEACTIVATE_TENANT_USER',
        'TENANT_USER',
        userId,
        { status: existing.status, email: existing.email },
        { status: 'DEACTIVATED' },
        ipAddress,
        userAgent,
      )
      return u
    })

    return c.json({ data: toResponse(deactivated) })
  } catch (err) {
    logger.error('DELETE admin/tenants/:tenantId/users/:userId: failed to deactivate', {
      error: String(err),
      userId,
      tenantId,
    })
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})
