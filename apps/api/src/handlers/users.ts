// ---------------------------------------------------------------------------
// Tenant user management handler — /api/v1/users/**
//
// Lets tenant administrators invite users, update their roles, and deactivate
// their accounts. All endpoints require the tenant_admin role.
//
// Endpoints:
//   GET    /                — list all TenantUsers for this tenant
//   POST   /invite          — invite a user (AdminCreateUser + TenantUser PENDING)
//   PATCH  /:id             — update Cedar role-group memberships (roleNames)
//   DELETE /:id             — deactivate (AdminDisableUser + TenantUser DEACTIVATED)
//
// Security invariants:
//   - requirePermission(Actions.X) enforced on all routes (Cedar/AVP)
//   - Deactivating the last active tenant_admin is rejected (lockout guard)
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
import { requirePermission } from '../middleware/rbac'
import { Actions } from '../authz/actions'
import { ROLE_OPTIONS } from '../authz/role-options'
import { resetCognitoUserPassword } from './admin/cognito'
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
  // Normalise to a canonical lowercase form so the Cognito username (created
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
    /** CrewMember to link this login to (driver persona); null unlinks. */
    crewMemberId: z.string().min(1).nullable().optional(),
  })
  .refine(
    (d) =>
      d.roleNames !== undefined ||
      d.legacyWindowsUsername !== undefined ||
      d.crewMemberId !== undefined,
    {
      message: 'At least one of roleNames, legacyWindowsUsername or crewMemberId must be provided',
    },
  )

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
  /** The CrewMember.id linked to this login (driver persona), or null. */
  crewMemberId: string | null
  /** The linked CrewMember's display name, or null. */
  crewMemberName: string | null
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
    crewMemberId: row.crewMember?.id ?? null,
    crewMemberName: row.crewMember?.name ?? null,
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export const usersHandler = new Hono<AppEnv>()

// ---------------------------------------------------------------------------
// GET /
//
// Lists all TenantUsers for the current tenant.
//
// Response: { data: TenantUserResponse[], meta: { count } }
// ---------------------------------------------------------------------------
usersHandler.get('/', requirePermission(Actions.ListUsers), async (c) => {
  const db = c.get('db')
  const repo = createUsersRepository(db)

  const users = await repo.listByTenant(c.get('tenantId'))
  return c.json({ data: users.map(toResponse), meta: { count: users.length } })
})

// ---------------------------------------------------------------------------
// GET /role-options
//
// Returns the catalog of Cedar role-groups a tenant admin may assign. The UI
// uses this to render the "Manage roles" multi-select. Names must match the
// `.cedar` policy files; see `authz/role-options.ts`.
//
// Response: { data: RoleOption[] }
// ---------------------------------------------------------------------------
usersHandler.get('/role-options', requirePermission(Actions.ListUsers), (c) => {
  return c.json({ data: ROLE_OPTIONS })
})

// ---------------------------------------------------------------------------
// POST /invite
//
// Invites a new user to the tenant:
//   1. Validate email is not already a TenantUser
//   2. Call cognito-idp:AdminCreateUser (sends invite email with temp password)
//   3. Create TenantUser record with status=PENDING
//
// Request:  { email: string, roleNames?: string[] }
// Response: { data: TenantUserResponse } (201)
//           { error, code: CONFLICT }             (409) — email already invited
//           { error, code: VALIDATION_ERROR }     (400)
//           { error, code: COGNITO_ERROR }        (500) — Cognito call failed
// ---------------------------------------------------------------------------
usersHandler.post(
  '/invite',
  requirePermission(Actions.InviteUser),
  validator('json', (value, c) => {
    const r = InviteUserBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const tenantId = c.get('tenantId')
    const repo = createUsersRepository(db)
    const { email, roleNames } = c.req.valid('json')

    // Check for existing user with this email
    const existing = await repo.findByEmail(email, tenantId)
    if (existing) {
      return c.json(
        { error: `User with email "${email}" is already invited to this tenant`, code: 'CONFLICT' },
        409,
      )
    }

    // Look up tenant name + slug so the CustomMessage Lambda trigger can
    // render a tenant-aware invite email and link to the right login page.
    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, slug: true },
    })

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
          ClientMetadata: {
            source: 'tenant',
            tenantId,
            tenantName: tenant?.name ?? '',
            tenantSlug: tenant?.slug ?? '',
          },
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
      const user = await repo.invite(tenantId, email, roleNames)
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
// Updates the Cedar role-group memberships of a TenantUser.
//
// Request:  { roleNames?: string[], legacyWindowsUsername?: string | null }
// Response: { data: TenantUserResponse } (200)
//           { error, code: NOT_FOUND }        (404)
//           { error, code: VALIDATION_ERROR } (400)
// ---------------------------------------------------------------------------
usersHandler.patch(
  '/:id',
  requirePermission(Actions.UpdateUser),
  validator('json', (value, c) => {
    const r = PatchUserBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const tenantId = c.get('tenantId')
    const repo = createUsersRepository(db)
    const id = c.req.param('id') ?? ''
    const { roleNames, legacyWindowsUsername, crewMemberId } = c.req.valid('json')

    const existing = await repo.findById(id, tenantId)
    if (!existing) {
      return c.json({ error: 'User not found', code: 'NOT_FOUND' }, 404)
    }

    // Validate the crew member belongs to this tenant before linking. The
    // tenant-scoped `db` filters by tenantId, so a foreign id yields null.
    if (typeof crewMemberId === 'string') {
      const crew = await db.crewMember.findFirst({
        where: { id: crewMemberId },
        select: { id: true },
      })
      if (!crew) {
        return c.json({ error: 'Crew member not found', code: 'NOT_FOUND' }, 404)
      }
    }

    let current = existing
    if (roleNames !== undefined) {
      current = await repo.updateRoleNames(id, roleNames)
    }
    if (legacyWindowsUsername !== undefined) {
      current = await repo.updateLegacyWindowsUsername(id, legacyWindowsUsername)
    }
    if (crewMemberId !== undefined) {
      await repo.linkCrewMember(id, crewMemberId)
      // The link is written on the CrewMember side — re-fetch so the response
      // reflects it alongside any role/legacy changes applied above.
      current = (await repo.findById(id, tenantId)) ?? current
    }
    return c.json({ data: toResponse(current) })
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
usersHandler.delete('/:id', requirePermission(Actions.DeactivateUser), async (c) => {
  const db = c.get('db')
  const tenantId = c.get('tenantId')
  const repo = createUsersRepository(db)
  const id = c.req.param('id') ?? ''

  const existing = await repo.findById(id, tenantId)
  if (!existing) {
    return c.json({ error: 'User not found', code: 'NOT_FOUND' }, 404)
  }

  if (existing.status === 'DEACTIVATED') {
    return c.json({ error: 'User is already deactivated', code: 'INVALID_STATE' }, 422)
  }

  // Prevent removing the last active admin — lockout guard.
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

// ---------------------------------------------------------------------------
// POST /:id/reset-password
//
// Admin-initiated password reset for an ACTIVE tenant user. Calls
// cognito-idp:AdminResetUserPassword, which emails the user a confirmation code;
// the user then sets a new password via the self-service "Forgot password"
// confirm UI. The admin never handles a temporary secret.
//
// Gated on `user:update` (UpdateUser) — resetting a password is a user-
// management mutation already granted to tenant admins; no new Cedar action.
//
// Response: { data: TenantUserResponse } (200)
//           { error, code: NOT_FOUND }      (404)
//           { error, code: INVALID_STATE }  (422) — user not ACTIVE
//           { error, code: COGNITO_ERROR }  (500) — Cognito call failed
// ---------------------------------------------------------------------------
usersHandler.post('/:id/reset-password', requirePermission(Actions.UpdateUser), async (c) => {
  const db = c.get('db')
  const tenantId = c.get('tenantId')
  const repo = createUsersRepository(db)
  const id = c.req.param('id') ?? ''

  const existing = await repo.findById(id, tenantId)
  if (!existing) {
    return c.json({ error: 'User not found', code: 'NOT_FOUND' }, 404)
  }

  // Only ACTIVE users have a usable password to reset. PENDING users re-resolve
  // through the invite / first-login set-password path; DEACTIVATED users are
  // blocked from signing in at all.
  if (existing.status !== 'ACTIVE') {
    return c.json(
      { error: 'Only active users can have their password reset', code: 'INVALID_STATE' },
      422,
    )
  }

  try {
    await resetCognitoUserPassword(existing.email)
  } catch (err) {
    logger.error('POST /users/:id/reset-password: Cognito AdminResetUserPassword failed', {
      error: String(err),
      id,
      email: existing.email,
    })
    return c.json(
      { error: 'Failed to reset the password. Please try again.', code: 'COGNITO_ERROR' },
      500,
    )
  }

  return c.json({ data: toResponse(existing) })
})
