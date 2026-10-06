// ---------------------------------------------------------------------------
// Tenant user management handler — /api/v1/users/**
//
// Lets tenant administrators invite users, update their roles, and deactivate
// their accounts. All endpoints require the tenant_admin role.
//
// Endpoints:
//   GET    /                — list all TenantUsers for this tenant
//   POST   /invite          — invite a user (AdminCreateUser + TenantUser PENDING)
//   POST   /:id/resend-invite — re-issue the invite for a PENDING user whose
//                               temporary password expired (7-day Cognito window)
//   POST   /import          — create users from a company's pegII employee
//                               directory, with or without an invite email
//   PATCH  /:id             — update Cedar role-group memberships (roleNames)
//   DELETE /:id             — deactivate (TenantUser DEACTIVATED — tenant-scoped only)
//   POST   /:id/reactivate  — reactivate (TenantUser ACTIVE — tenant-scoped only)
//
// Security invariants:
//   - requirePermission(Actions.X) enforced on all routes (Cedar/AVP)
//   - Deactivating the last active tenant_admin is rejected (lockout guard)
//   - Inviting an already-existing user email returns 409 CONFLICT
//   - Deactivate/reactivate touch ONLY this tenant's TenantUser row — they
//     never call a Cognito Admin*User command. Cognito user pools are shared
//     across every tenant on the platform (one pool, keyed by email), so an
//     AdminDisableUser/AdminEnableUser call would lock a person out of (or
//     back into) every OTHER tenant they belong to, not just this one. The
//     real per-tenant login gate is TenantUser.status, enforced by the
//     Pre-Token-Generation Lambda (cognito/pre-token.ts) on every login and
//     token refresh — flipping that column here is sufficient on its own.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { requirePermission } from '../middleware/rbac'
import { Actions } from '../authz/actions'
import { ROLE_OPTIONS } from '../authz/role-options'
import {
  provisionCognitoUser,
  resetCognitoUserPassword,
  resendCognitoInvite,
} from './admin/cognito'
import { createUsersRepository, type TenantUserRow } from '../repositories/users'
import type { AppEnv } from '../types'
import type { PrismaClient } from '@prisma/client'
import { logger } from '../lib/logger'
import {
  CompanyDirectoryRefused,
  readCompanyDirectory,
  syncCompanyMemberships,
  type MembershipSyncSummary,
} from '../lib/company-directory'
import { PegiiApiError, pegiiApiErrorToHttp } from '../lib/pegii-api-client'

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

const ROLE_NAMES = new Set(ROLE_OPTIONS.map((r) => r.name))

/** Most employees one import may create — each is a sequential Cognito call. */
const IMPORT_MAX = 50

const ImportUsersBody = z
  .object({
    companyId: z.string().min(1),
    /** salesman.code values from GET /settings/companies/:id/directory. */
    employeeCodes: z.array(z.number().int().nonnegative()).min(1).max(IMPORT_MAX),
    roleNames: z
      .array(z.string().min(1))
      .min(1)
      .refine((names) => names.every((n) => ROLE_NAMES.has(n)), 'unknown role name'),
    /** false ⇒ SSO-only: no Cognito user, no email, no password. */
    sendInvite: z.boolean(),
  })
  .strict()

const PatchUserBody = z
  .object({
    roleNames: z.array(z.string().min(1)).optional(),
    legacyWindowsUsername: z.string().min(1).max(255).nullable().optional(),
    /** CrewMember to link this login to (driver persona); null unlinks. */
    crewMemberId: z.string().min(1).nullable().optional(),
    /** Legacy longhaul driver id (v_longhaul_drivers.driver_id); null unmaps. */
    longhaulDriverId: z.number().int().positive().nullable().optional(),
  })
  .refine(
    (d) =>
      d.roleNames !== undefined ||
      d.legacyWindowsUsername !== undefined ||
      d.crewMemberId !== undefined ||
      d.longhaulDriverId !== undefined,
    {
      message:
        'At least one of roleNames, legacyWindowsUsername, crewMemberId or longhaulDriverId must be provided',
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
  /** Legacy longhaul driver id (v_longhaul_drivers.driver_id) this login maps to, or null. */
  longhaulDriverId: number | null
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
  /** Signs in only through the tenant's SSO provider — no invite, no password. */
  ssoOnly: boolean
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
    longhaulDriverId: row.longhaulDriverId,
    roleNames: row.roleNames,
    role: deriveLegacyRole(row.roleNames),
    status: row.status,
    invitedAt: row.invitedAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    crewMemberId: row.crewMember?.id ?? null,
    crewMemberName: row.crewMember?.name ?? null,
    ssoOnly: row.ssoOnly,
  }
}

type CreateUserOutcome =
  { kind: 'created'; user: TenantUserRow } | { kind: 'conflict' } | { kind: 'cognito_error' }

/**
 * Create one TenantUser — the core of POST /invite and POST /import.
 *
 * `sendInvite` provisions the Cognito user first (AdminCreateUser emails a
 * temporary password; a person who already has a Cognito identity is reused,
 * see handlers/admin/cognito.ts), then writes the PENDING row — so a Cognito
 * failure leaves no row. Without it the row is written SSO-only and Cognito is
 * never called: cognito/pre-token.ts activates it on the first federated login.
 */
async function createTenantUser(
  db: PrismaClient,
  tenantId: string,
  email: string,
  roleNames: string[],
  opts: { sendInvite: boolean; legacyWindowsUsername?: string | null },
): Promise<CreateUserOutcome> {
  const repo = createUsersRepository(db)
  if (opts.sendInvite) {
    // Look up tenant name + slug so the CustomMessage Lambda trigger can
    // render a tenant-aware invite email and link to the right login page.
    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, slug: true },
    })
    try {
      await provisionCognitoUser(email, {
        tenantId,
        tenantName: tenant?.name ?? '',
        tenantSlug: tenant?.slug ?? '',
      })
    } catch (err) {
      logger.error('users: Cognito provisioning failed', { error: String(err), email })
      return { kind: 'cognito_error' }
    }
  }
  try {
    const user = await repo.invite(tenantId, email, roleNames, {
      ssoOnly: !opts.sendInvite,
      legacyWindowsUsername: opts.legacyWindowsUsername ?? null,
    })
    return { kind: 'created', user }
  } catch (err) {
    // P2002 = unique constraint — race condition (concurrent invite)
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return { kind: 'conflict' }
    }
    throw err
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

    // Provision in Cognito, then the row. A person who already has a Cognito
    // identity (invited before, or registered through another tenant — in any
    // letter case) is reused, not duplicated; see handlers/admin/cognito.ts.
    const outcome = await createTenantUser(db, tenantId, email, roleNames, { sendInvite: true })
    if (outcome.kind === 'cognito_error') {
      return c.json(
        { error: 'Failed to create the user account. Please try again.', code: 'COGNITO_ERROR' },
        500,
      )
    }
    if (outcome.kind === 'conflict') {
      return c.json(
        {
          error: `User with email "${email}" is already invited to this tenant`,
          code: 'CONFLICT',
        },
        409,
      )
    }
    return c.json({ data: toResponse(outcome.user) }, 201)
  },
)

// ---------------------------------------------------------------------------
// PATCH /:id
//
// Updates the Cedar role-group memberships of a TenantUser.
//
// Request:  { roleNames?, legacyWindowsUsername?, crewMemberId?, longhaulDriverId? }
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
    const { roleNames, legacyWindowsUsername, crewMemberId, longhaulDriverId } = c.req.valid('json')

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
    if (longhaulDriverId !== undefined) {
      current = await repo.updateLonghaulDriverId(id, longhaulDriverId)
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
// Deactivates a TenantUser, scoped to this tenant only:
//   1. Guard against deactivating the last active ADMIN
//   2. Set TenantUser status=DEACTIVATED
//
// Does NOT touch Cognito — see the file header for why (shared user pool
// across tenants; the real per-tenant gate is TenantUser.status, enforced
// at token-issuance time by cognito/pre-token.ts).
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

  const deactivated = await repo.deactivate(id)
  return c.json({ data: toResponse(deactivated) })
})

// ---------------------------------------------------------------------------
// POST /:id/reactivate
//
// Reactivates a deactivated TenantUser, scoped to this tenant only. Does not
// touch Cognito — see the file header / DELETE /:id for why.
//
// Response: { data: TenantUserResponse } (200)
//           { error, code: NOT_FOUND }        (404)
//           { error, code: INVALID_STATE }    (422) — user is not deactivated
// ---------------------------------------------------------------------------
usersHandler.post('/:id/reactivate', requirePermission(Actions.ReactivateUser), async (c) => {
  const db = c.get('db')
  const tenantId = c.get('tenantId')
  const repo = createUsersRepository(db)
  const id = c.req.param('id') ?? ''

  const existing = await repo.findById(id, tenantId)
  if (!existing) {
    return c.json({ error: 'User not found', code: 'NOT_FOUND' }, 404)
  }

  if (existing.status !== 'DEACTIVATED') {
    return c.json({ error: 'User is not deactivated', code: 'INVALID_STATE' }, 422)
  }

  const reactivated = await repo.reactivate(id)
  return c.json({ data: toResponse(reactivated) })
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

  // An SSO-only user has no password; resetting would mint a native Cognito
  // user — a second identity for the same person.
  if (existing.ssoOnly) {
    return c.json(
      { error: 'This user signs in with SSO only and has no password.', code: 'SSO_ONLY' },
      422,
    )
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

  // No cognitoSub ⇒ this row has never signed in, so it owns no Cognito identity
  // to reset. Refused before any Cognito call: such a row can be minted for
  // someone else's address (invite → deactivate → reactivate), and the shared
  // pool would otherwise let this tenant reach that person's account.
  if (!existing.cognitoSub) {
    return c.json(
      {
        error: 'This user has not signed in yet, so there is no password to reset.',
        code: 'NO_SIGN_IN',
      },
      422,
    )
  }

  // Same tenant lookup as POST /invite — a user who never set a password is sent
  // a fresh temporary password, and that email is rendered tenant-aware.
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, slug: true },
  })

  let outcome: Awaited<ReturnType<typeof resetCognitoUserPassword>>
  try {
    outcome = await resetCognitoUserPassword(existing.email, existing.cognitoSub, {
      tenantId,
      tenantName: tenant?.name ?? '',
      tenantSlug: tenant?.slug ?? '',
    })
  } catch (err) {
    logger.error('POST /users/:id/reset-password: Cognito password reset failed', {
      error: String(err),
      id,
      email: existing.email,
    })
    return c.json(
      { error: 'Failed to reset the password. Please try again.', code: 'COGNITO_ERROR' },
      500,
    )
  }

  // This used to be swallowed and answered 200, so an admin clicking "Reset
  // password" for a user Cognito could not find saw success and nothing happened.
  if (outcome === 'not_found') {
    logger.warn('POST /users/:id/reset-password: no Cognito sign-in for this user', {
      id,
      tenantId,
    })
    return c.json({ error: 'This user has no password sign-in to reset.', code: 'NO_SIGN_IN' }, 422)
  }

  logger.info('POST /users/:id/reset-password: done', { id, tenantId, outcome })
  // `delivery` tells the UI what was emailed: a user who never set a password
  // gets a temporary password, and "Forgot password" does not work for them.
  return c.json({
    data: {
      ...toResponse(existing),
      delivery: outcome === 'reset' ? 'reset_code' : 'temporary_password',
    },
  })
})

// ---------------------------------------------------------------------------
// POST /:id/resend-invite
//
// Re-issues the invitation for a PENDING user — the way out of an expired
// temporary password.
//
// Cognito temp passwords expire after 7 days (`tempPasswordValidity`, see
// cognito-stack.ts). Past that window the invitee cannot sign in, and until this
// route existed neither the admin nor the user had a way forward: POST /invite
// 409s because the TenantUser row already exists, and POST /:id/reset-password
// 422s because the user is not ACTIVE.
//
// Gated on `user:invite` (InviteUser) — re-inviting is the same act as inviting,
// so no new Cedar action and no AVP policy sync.
//
// Cross-tenant guard: a PENDING row proves nothing about who the email belongs
// to, because POST /invite accepts an arbitrary address and its
// UsernameExistsException is swallowed — so an admin can mint a PENDING row in
// their own tenant for a person who is an active user of a different one. The
// Cognito pool is shared and keyed by email (file header above), so acting on
// such a row would reach across tenants. Two independent things stop that: the
// roster check below, and resendCognitoInvite refusing every Cognito state
// except FORCE_CHANGE_PASSWORD (never-logged-in-anywhere).
//
// Response: { data: TenantUserResponse } (200) — the row is unchanged
//           { error, code: NOT_FOUND }      (404)
//           { error, code: INVALID_STATE }  (422) — user not PENDING, or the
//                                                   identity is already
//                                                   registered platform-wide
//           { error, code: COGNITO_ERROR }  (500) — Cognito call failed
// ---------------------------------------------------------------------------
usersHandler.post('/:id/resend-invite', requirePermission(Actions.InviteUser), async (c) => {
  const db = c.get('db')
  const tenantId = c.get('tenantId')
  const repo = createUsersRepository(db)
  const id = c.req.param('id') ?? ''

  const existing = await repo.findById(id, tenantId)
  if (!existing) {
    return c.json({ error: 'User not found', code: 'NOT_FOUND' }, 404)
  }

  // An SSO-only user was never invited: resending would create a native Cognito
  // user and email a password — silently converting them, and leaving the
  // person two identities once they sign in with SSO.
  if (existing.ssoOnly) {
    return c.json(
      {
        error: 'This user signs in with SSO only; there is no invitation to send.',
        code: 'SSO_ONLY',
      },
      422,
    )
  }

  // Only PENDING users have an outstanding invitation. An ACTIVE user has
  // "Reset password"; a DEACTIVATED user must be reactivated first.
  if (existing.status !== 'PENDING') {
    return c.json(
      { error: 'Only pending users can have their invitation resent', code: 'INVALID_STATE' },
      422,
    )
  }

  // TenantUser is not in TENANT_SCOPED_MODELS (lib/prisma.ts), so this query is
  // deliberately cross-tenant: it asks whether this email is already somebody's
  // working login on another tenant. If it is, the shared Cognito identity is
  // theirs and is not ours to touch.
  const rosteredElsewhere = await db.tenantUser.findFirst({
    where: { email: existing.email, tenantId: { not: tenantId }, status: 'ACTIVE' },
    select: { id: true },
  })
  if (rosteredElsewhere) {
    logger.warn('POST /users/:id/resend-invite: refused — email is active on another tenant', {
      id,
      tenantId,
    })
    return c.json(
      {
        error:
          'This email already has a Pegasus sign-in. Ask them to sign in — their access to this account activates automatically.',
        code: 'INVALID_STATE',
      },
      422,
    )
  }

  // Same tenant lookup as POST /invite — the CustomMessage Lambda needs it to
  // render a tenant-aware email and link to the right login page.
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, slug: true },
  })

  try {
    const outcome = await resendCognitoInvite(existing.email, {
      tenantId,
      tenantName: tenant?.name ?? '',
      tenantSlug: tenant?.slug ?? '',
    })

    // The identity exists and is past the invite stage — no email was sent and
    // nothing was mutated. Nothing failed, but there is no invitation to resend.
    if (outcome === 'already_registered') {
      logger.warn('POST /users/:id/resend-invite: identity already registered platform-wide', {
        id,
        tenantId,
      })
      return c.json(
        {
          error:
            'This email already has a Pegasus sign-in. Ask them to sign in — their access to this account activates automatically.',
          code: 'INVALID_STATE',
        },
        422,
      )
    }

    logger.info('POST /users/:id/resend-invite: invitation re-issued', {
      id,
      email: existing.email,
      tenantId,
      outcome,
    })
  } catch (err) {
    logger.error('POST /users/:id/resend-invite: Cognito call failed', {
      error: String(err),
      id,
      email: existing.email,
    })
    return c.json(
      { error: 'Failed to resend the invitation. Please try again.', code: 'COGNITO_ERROR' },
      500,
    )
  }

  return c.json({ data: toResponse(existing) })
})

// ---------------------------------------------------------------------------
// POST /import
//
// Creates users from a company's pegII employee directory ("Add from pegII").
// The client sends employee CODES only; the directory is re-read here, so an
// email never comes from the browser. Each employee is processed on its own —
// one failure doesn't stop the rest — and the response lists every outcome.
//
//   sendInvite: true  — the same path as POST /invite (Cognito user + emailed
//                       temporary password).
//   sendInvite: false — SSO-only: the row alone, no Cognito call; the person
//                       signs in through the tenant's SSO provider, matched by
//                       email on first login (cognito/pre-token.ts). Requires
//                       an enabled SSO provider, or they could never sign in.
//
// Skips (no row written): not in the directory / not active / no email /
// already a user of this tenant / an ACTIVE login on another tenant (the #673
// roster rule — the shared Cognito identity isn't ours to provision; use
// POST /invite deliberately for a multi-tenant person).
//
// Afterwards the company's membership sync runs, so new users are linked to
// their employee rows (emp/wun) at once. A sync failure doesn't undo anything;
// it is reported in `membershipSync.error`.
//
// Response: { data: { results: ImportResult[], created, membershipSync } } (200)
//           400 VALIDATION_ERROR · 404 NOT_FOUND · 409 SITE_CLOUD_AUTH_DISABLED
//           422 SSO_NOT_CONFIGURED · pegII failures per pegiiApiErrorToHttp
// ---------------------------------------------------------------------------

type ImportResult = {
  code: number
  email: string | null
  status: 'created' | 'invited' | 'skipped' | 'failed'
  userId?: string
  reason?:
    | 'NOT_IN_DIRECTORY'
    | 'INACTIVE'
    | 'NO_EMAIL'
    | 'ALREADY_A_USER'
    | 'ACTIVE_IN_ANOTHER_TENANT'
    | 'COGNITO_ERROR'
    | 'ERROR'
}

const EmailShape = z.string().email()

usersHandler.post(
  '/import',
  requirePermission(Actions.InviteUser),
  validator('json', (value, c) => {
    const r = ImportUsersBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db') as PrismaClient
    const tenantId = c.get('tenantId')
    const { companyId, employeeCodes, roleNames, sendInvite } = c.req.valid('json')

    if (!sendInvite) {
      const providers = await db.tenantSsoProvider.count({ where: { tenantId, isEnabled: true } })
      if (providers === 0) {
        return c.json(
          {
            error:
              'SSO-only users need an enabled SSO provider to sign in. Turn on "Send invite", or set up SSO first.',
            code: 'SSO_NOT_CONFIGURED',
          },
          422,
        )
      }
    }

    // All employees (not just active): the membership sync below needs leavers.
    let directory: Awaited<ReturnType<typeof readCompanyDirectory>>['directory']
    try {
      ;({ directory } = await readCompanyDirectory(c, companyId))
    } catch (err) {
      if (err instanceof CompanyDirectoryRefused) {
        return c.json({ error: err.message, code: err.code }, err.status)
      }
      if (err instanceof PegiiApiError) {
        const { status, code, message } = pegiiApiErrorToHttp(err)
        return c.json({ error: message, code, correlationId: c.get('correlationId') }, status)
      }
      throw err
    }
    const byCode = new Map(directory.map((s) => [Number(s.id), s]))
    const repo = createUsersRepository(db)

    const results: ImportResult[] = []
    for (const code of [...new Set(employeeCodes)]) {
      const employee = byCode.get(code)
      if (!employee) {
        results.push({ code, email: null, status: 'skipped', reason: 'NOT_IN_DIRECTORY' })
        continue
      }
      const email = employee.email?.trim().toLowerCase() || null
      if (!employee.active) {
        results.push({ code, email, status: 'skipped', reason: 'INACTIVE' })
        continue
      }
      if (!email || !EmailShape.safeParse(email).success) {
        results.push({ code, email, status: 'skipped', reason: 'NO_EMAIL' })
        continue
      }
      try {
        const existing = await repo.findByEmail(email, tenantId)
        if (existing) {
          results.push({
            code,
            email,
            status: 'skipped',
            reason: 'ALREADY_A_USER',
            userId: existing.id,
          })
          continue
        }
        // TenantUser isn't tenant-scoped: deliberately cross-tenant (see resend-invite).
        const elsewhere = await db.tenantUser.findFirst({
          where: {
            email: { equals: email, mode: 'insensitive' },
            tenantId: { not: tenantId },
            status: 'ACTIVE',
          },
          select: { id: true },
        })
        if (elsewhere) {
          results.push({ code, email, status: 'skipped', reason: 'ACTIVE_IN_ANOTHER_TENANT' })
          continue
        }
        const outcome = await createTenantUser(db, tenantId, email, roleNames, {
          sendInvite,
          legacyWindowsUsername: employee.winUsername,
        })
        if (outcome.kind === 'created') {
          results.push({
            code,
            email,
            status: sendInvite ? 'invited' : 'created',
            userId: outcome.user.id,
          })
        } else if (outcome.kind === 'conflict') {
          results.push({ code, email, status: 'skipped', reason: 'ALREADY_A_USER' })
        } else {
          results.push({ code, email, status: 'failed', reason: 'COGNITO_ERROR' })
        }
      } catch (err) {
        logger.error('POST /users/import: row failed', { error: String(err), code, tenantId })
        results.push({ code, email, status: 'failed', reason: 'ERROR' })
      }
    }

    const created = results.filter((r) => r.status === 'created' || r.status === 'invited').length
    let membershipSync: MembershipSyncSummary | { error: string } | null = null
    if (created > 0) {
      try {
        membershipSync = await syncCompanyMemberships(db, tenantId, companyId, directory)
      } catch (err) {
        logger.error('POST /users/import: membership sync failed', {
          error: String(err),
          tenantId,
        })
        membershipSync = {
          error:
            'Users were created, but linking them to employees failed. Run Sync employees on Settings → Companies.',
        }
      }
    }

    // Counts only — no emails in the log.
    logger.info('POST /users/import', {
      tenantId,
      companyId,
      sendInvite,
      requested: employeeCodes.length,
      created,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: results.filter((r) => r.status === 'failed').length,
    })
    return c.json({ data: { results, created, membershipSync } })
  },
)
