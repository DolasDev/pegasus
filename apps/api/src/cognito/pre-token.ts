// ---------------------------------------------------------------------------
// Cognito Pre-Token-Generation Lambda trigger
//
// Injects custom claims into the ID token after successful authentication.
// The backend middleware relies on these claims so it does not have to
// re-evaluate context on every API request.
//
// Routing is based on callerContext.clientId (which Cognito app client
// initiated the auth), NOT on group membership. This cleanly separates
// admin and tenant login flows:
//
// ADMIN APP CLIENT:
//   No custom claims — admin gating uses the cognito:groups PLATFORM_ADMIN
//   membership directly via adminAuthMiddleware.
//
// TENANT / MOBILE APP CLIENT:
//   Resolve the active tenant from an AuthSession (multi-tenant picker)
//   or fall back to email domain lookup, then look up the TenantUser
//   record to determine roleNames and status:
//
//   ACTIVE      → inject custom:tenantId + custom:roles (Cedar groups)
//   PENDING     → first login: inject claims, set status=ACTIVE + activatedAt + cognitoSub
//   DEACTIVATED → block token generation (fail-closed)
//   Not found   → block token generation (strict invite-only)
//
// NO-GROUP ADMIN USERS:
//   Allow token issuance with no custom claims (admin setup flow only).
//   Tenant users with no groups proceed to full tenant resolution.
// ---------------------------------------------------------------------------

import type { PreTokenGenerationTriggerHandler } from 'aws-lambda'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import { createLogger } from '../lib/logger'

const logger = createLogger('pegasus-pre-token')

// Use a shared client to pool connections across warm invocations.
// Prisma 7 requires an explicit driver adapter for database connections.
// In Lambda, DATABASE_URL is always injected by CDK. The fallback prevents
// a module-level throw that would break test mocking (vi.mock replaces the
// PrismaClient constructor, but process.env is checked before it runs).
const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' })
const db = new PrismaClient({ adapter })
const ssm = new SSMClient({})

// ---------------------------------------------------------------------------
// Admin client ID — read from SSM once at cold start, cached thereafter.
//
// The CDK stack stores the admin app client ID at this well-known path.
// Reading from SSM (instead of an env var) breaks a circular CloudFormation
// dependency: Lambda → UserPoolClient → UserPool → Lambda.
// ---------------------------------------------------------------------------
const ADMIN_CLIENT_ID_PARAM = '/pegasus/admin/cognito-admin-client-id'
let _adminClientId: string | null = null

async function getAdminClientId(): Promise<string> {
  if (_adminClientId) return _adminClientId

  const result = await ssm.send(new GetParameterCommand({ Name: ADMIN_CLIENT_ID_PARAM }))

  const value = result.Parameter?.Value
  if (!value) {
    throw new Error(`SSM parameter ${ADMIN_CLIENT_ID_PARAM} not found or empty`)
  }

  _adminClientId = value
  return value
}

export const handler: PreTokenGenerationTriggerHandler = async (event) => {
  const groups: string[] = event.request.groupConfiguration?.groupsToOverride ?? []

  // -------------------------------------------------------------------------
  // Route by app client — admin and tenant flows are completely independent.
  // -------------------------------------------------------------------------
  const clientId = event.callerContext.clientId
  const adminClientId = await getAdminClientId()

  if (clientId === adminClientId) {
    // -----------------------------------------------------------------------
    // Admin client — no custom claims at all.
    //
    // Admin gating is enforced downstream by adminAuthMiddleware via the
    // PLATFORM_ADMIN cognito:groups membership (which Cognito injects into
    // the token automatically from the user's group memberships). Emitting
    // an additional `custom:role` claim was historically used for routing
    // but no production code reads it any more.
    // -----------------------------------------------------------------------
    logger.info('Pre-Token trigger: Admin client — no custom claims', {
      userName: event.userName,
      groupCount: groups.length,
    })
    return event
  }

  // -------------------------------------------------------------------------
  // TENANT / MOBILE APP CLIENT — full tenant resolution flow.
  // -------------------------------------------------------------------------
  const email = event.request.userAttributes.email
  const sub = event.request.userAttributes.sub

  if (!email) {
    logger.error('Pre-Token trigger: Missing email claim')
    throw new Error('Authentication failed: No email associated with identity')
  }

  const normalizedEmail = email.toLowerCase()

  const domain = normalizedEmail.split('@')[1]
  if (!domain) {
    logger.error('Pre-Token trigger: Invalid email format', { email })
    throw new Error('Authentication failed: Invalid email format')
  }

  // -------------------------------------------------------------------------
  // Step 1: Check for a pending AuthSession (created by POST /api/auth/select-tenant).
  // If found, use its tenantId — this bypasses the email domain restriction,
  // enabling cross-org users (contractors, invited users with different domains).
  // -------------------------------------------------------------------------
  // AuthSession.email is stored lowercase by select-tenant, so match with
  // the normalised email to avoid case-mismatch misses.
  const authSession = await db.authSession.findFirst({
    where: { email: normalizedEmail, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, tenantId: true },
  })

  let tenantId: string

  if (authSession) {
    // Use the session-selected tenant.
    tenantId = authSession.tenantId

    // Consume the session — fire-and-forget so it does not block token issuance.
    db.authSession.deleteMany({ where: { id: authSession.id } }).catch((err: unknown) => {
      logger.warn('Pre-Token trigger: Failed to delete consumed AuthSession', {
        sessionId: authSession.id,
        error: err instanceof Error ? err.message : String(err),
      })
    })

    logger.info('Pre-Token trigger: Resolved tenant via AuthSession', { email, tenantId })
  } else {
    // -----------------------------------------------------------------------
    // Step 2: No pending session — fall back to email domain resolution.
    // -----------------------------------------------------------------------
    const tenant = await db.tenant.findFirst({
      where: { emailDomains: { has: domain }, status: 'ACTIVE' },
      select: { id: true },
    })

    if (!tenant) {
      logger.warn('Pre-Token trigger: No active tenant for domain', { domain })
      throw new Error(
        'Your email domain is not associated with any active Pegasus tenant. Contact your administrator.',
      )
    }

    tenantId = tenant.id
  }

  // -------------------------------------------------------------------------
  // Look up the TenantUser roster entry for this email within the resolved tenant.
  // Strict invite-only — no JIT provisioning.
  // -------------------------------------------------------------------------
  const tenantUser = await db.tenantUser.findFirst({
    where: {
      tenantId,
      email: { equals: normalizedEmail, mode: 'insensitive' },
    },
    select: { id: true, roleNames: true, status: true },
  })

  if (!tenantUser) {
    logger.warn('Pre-Token trigger: User not in tenant roster', { email, tenantId })
    throw new Error('Your account has not been granted access. Contact your administrator.')
  }

  if (tenantUser.status === 'DEACTIVATED') {
    logger.warn('Pre-Token trigger: Deactivated user attempted login', {
      email,
      tenantId,
    })
    throw new Error('Your account has been deactivated. Contact your administrator.')
  }

  // -------------------------------------------------------------------------
  // PENDING → first login: activate the account.
  // -------------------------------------------------------------------------
  if (tenantUser.status === 'PENDING') {
    await db.tenantUser.update({
      where: { id: tenantUser.id },
      data: {
        status: 'ACTIVE',
        activatedAt: new Date(),
        ...(sub ? { cognitoSub: sub } : {}),
      },
    })
    logger.info('Pre-Token trigger: First login — tenant user activated', {
      email,
      tenantId,
      roleNames: tenantUser.roleNames,
    })
  }

  // Cedar role-group memberships for AVP. Authoritative source is
  // tenantUser.roleNames. Empty roleNames yield no Cedar groups, which makes
  // every group-gated permit evaluate to false (empty /me/permissions and
  // 403 on requirePermission-guarded routes) — the correct fail-closed
  // outcome for a misconfigured user, surfaced loudly enough that an admin
  // can fix it via PATCH /users/:id.
  const cedarRoles = tenantUser.roleNames

  event.response = {
    claimsOverrideDetails: {
      claimsToAddOrOverride: {
        'custom:tenantId': tenantId,
        'custom:roles': JSON.stringify(cedarRoles),
      },
      // Mirror the Cedar role names into `cognito:groups` so the token shape
      // matches what AVP's Cognito identity source records expect. The API's
      // AVP backend doesn't read the claim (it builds the entity hierarchy
      // from custom:roles via lib/authz.ts), but keeping it lets future
      // groupConfiguration-based IdPs work without a pre-token Lambda change.
      groupOverrideDetails: {
        groupsToOverride: cedarRoles,
      },
    },
  }

  return event
}
