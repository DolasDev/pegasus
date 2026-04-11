// ---------------------------------------------------------------------------
// Tenant user management handler — /api/v1/users/**
//
// Lets tenant administrators invite users, update their roles, and deactivate
// their accounts. All endpoints require the tenant_admin role.
//
// Endpoints:
//   GET    /                — list all TenantUsers for this tenant
//   POST   /invite          — invite a user (AdminCreateUser + TenantUser PENDING)
//   PATCH  /:id             — update role (ADMIN ↔ USER)
//   DELETE /:id             — deactivate (AdminDisableUser + TenantUser DEACTIVATED)
//
// Security invariants:
//   - requireRole(['tenant_admin']) enforced on all routes
//   - Deactivating the last active ADMIN is rejected (lockout guard)
//   - Inviting an already-existing user email returns 409 CONFLICT
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { requireRole } from '../middleware/rbac'
import { createUsersRepository, type TenantUserRow } from '../repositories/users'
import type { AppEnv } from '../types'
import { logger } from '../lib/logger'

// ---------------------------------------------------------------------------
// Cognito client singleton — reused across warm invocations
// ---------------------------------------------------------------------------
let _cognito: CognitoIdentityProviderClient | null = null
function getCognito(): CognitoIdentityProviderClient {
  return (_cognito ??= new CognitoIdentityProviderClient({}))
}

const USER_POOL_ID = process.env['COGNITO_USER_POOL_ID'] ?? ''

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const InviteUserBody = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'USER']).default('USER'),
})

const PatchUserBody = z.object({
  role: z.enum(['ADMIN', 'USER']),
})

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

type TenantUserResponse = {
  id: string
  email: string
  cognitoSub: string | null
  role: 'ADMIN' | 'USER'
  status: 'PENDING' | 'ACTIVE' | 'DEACTIVATED'
  invitedAt: string
  activatedAt: string | null
  deactivatedAt: string | null
}

function toResponse(row: TenantUserRow): TenantUserResponse {
  return {
    id: row.id,
    email: row.email,
    cognitoSub: row.cognitoSub,
    role: row.role,
    status: row.status,
    invitedAt: row.invitedAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export const usersHandler = new Hono<AppEnv>()

// All endpoints in this handler require tenant_admin.
usersHandler.use('*', requireRole(['tenant_admin']))

// ---------------------------------------------------------------------------
// GET /
//
// Lists all TenantUsers for the current tenant.
//
// Response: { data: TenantUserResponse[], meta: { count } }
// ---------------------------------------------------------------------------
usersHandler.get('/', async (c) => {
  const db = c.get('db')
  const repo = createUsersRepository(db)

  const users = await repo.listByTenant(c.get('tenantId'))
  return c.json({ data: users.map(toResponse), meta: { count: users.length } })
})

// ---------------------------------------------------------------------------
// POST /invite
//
// Invites a new user to the tenant:
//   1. Validate email is not already a TenantUser
//   2. Call cognito-idp:AdminCreateUser (sends invite email with temp password)
//   3. Create TenantUser record with status=PENDING
//
// Request:  { email: string, role?: 'ADMIN' | 'USER' }
// Response: { data: TenantUserResponse } (201)
//           { error, code: CONFLICT }             (409) — email already invited
//           { error, code: VALIDATION_ERROR }     (400)
//           { error, code: COGNITO_ERROR }        (500) — Cognito call failed
// ---------------------------------------------------------------------------
usersHandler.post(
  '/invite',
  validator('json', (value, c) => {
    const r = InviteUserBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const tenantId = c.get('tenantId')
    const repo = createUsersRepository(db)
    const { email, role } = c.req.valid('json')

    // Check for existing user with this email
    const existing = await repo.findByEmail(email, tenantId)
    if (existing) {
      return c.json(
        { error: `User with email "${email}" is already invited to this tenant`, code: 'CONFLICT' },
        409,
      )
    }

    // Provision in Cognito
    try {
      await getCognito().send(
        new AdminCreateUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: email,
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
          ],
          ...(process.env['NODE_ENV'] !== 'production'
            ? { MessageAction: 'SUPPRESS' as const }
            : {}),
        }),
      )
    } catch (err) {
      // UsernameExistsException — user already exists in Cognito (invited before or
      // registered through another tenant). Continue to create the TenantUser record.
      if ((err as { name?: string }).name !== 'UsernameExistsException') {
        logger.error('POST /users/invite: Cognito AdminCreateUser failed', {
          error: String(err),
          email,
        })
        return c.json(
          { error: 'Failed to create the user account. Please try again.', code: 'COGNITO_ERROR' },
          500,
        )
      }
    }

    // Create TenantUser record
    try {
      const user = await repo.invite(tenantId, email, role)
      return c.json({ data: toResponse(user) }, 201)
    } catch (err) {
      // P2002 = unique constraint — race condition (concurrent invite)
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        return c.json(
          {
            error: `User with email "${email}" is already invited to this tenant`,
            code: 'CONFLICT',
          },
          409,
        )
      }
      throw err
    }
  },
)

// ---------------------------------------------------------------------------
// PATCH /:id
//
// Updates the role of a TenantUser (ADMIN ↔ USER).
//
// Request:  { role: 'ADMIN' | 'USER' }
// Response: { data: TenantUserResponse } (200)
//           { error, code: NOT_FOUND }        (404)
//           { error, code: VALIDATION_ERROR } (400)
// ---------------------------------------------------------------------------
usersHandler.patch(
  '/:id',
  validator('json', (value, c) => {
    const r = PatchUserBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const tenantId = c.get('tenantId')
    const repo = createUsersRepository(db)
    const id = c.req.param('id')
    const { role } = c.req.valid('json')

    const existing = await repo.findById(id, tenantId)
    if (!existing) {
      return c.json({ error: 'User not found', code: 'NOT_FOUND' }, 404)
    }

    const updated = await repo.updateRole(id, role)
    return c.json({ data: toResponse(updated) })
  },
)

// ---------------------------------------------------------------------------
// DELETE /:id
//
// Deactivates a TenantUser:
//   1. Guard against deactivating the last active ADMIN
//   2. Call cognito-idp:AdminDisableUser (blocks further logins)
//   3. Set TenantUser status=DEACTIVATED
//
// Response: { data: TenantUserResponse } (200)
//           { error, code: NOT_FOUND }        (404)
//           { error, code: LAST_ADMIN }       (422) — cannot remove last admin
// ---------------------------------------------------------------------------
usersHandler.delete('/:id', async (c) => {
  const db = c.get('db')
  const tenantId = c.get('tenantId')
  const repo = createUsersRepository(db)
  const id = c.req.param('id')

  const existing = await repo.findById(id, tenantId)
  if (!existing) {
    return c.json({ error: 'User not found', code: 'NOT_FOUND' }, 404)
  }

  if (existing.status === 'DEACTIVATED') {
    return c.json({ error: 'User is already deactivated', code: 'INVALID_STATE' }, 422)
  }

  // Prevent removing the last active admin — lockout guard.
  if (existing.role === 'ADMIN') {
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

  // Disable in Cognito (fail-open if user not found — they may never have logged in)
  try {
    await getCognito().send(
      new AdminDisableUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: existing.email,
      }),
    )
  } catch (err) {
    const errName =
      typeof err === 'object' && err !== null && 'name' in err ? (err as { name: string }).name : ''
    if (errName !== 'UserNotFoundException') {
      logger.error('DELETE /users/:id: Cognito AdminDisableUser failed', {
        error: String(err),
        id,
        email: existing.email,
      })
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  }

  const deactivated = await repo.deactivate(id)
  return c.json({ data: toResponse(deactivated) })
})
