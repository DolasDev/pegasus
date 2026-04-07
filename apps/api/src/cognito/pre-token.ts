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
//   Inject custom:role = 'platform_admin'. No tenant lookup.
//
// TENANT / MOBILE APP CLIENT:
//   Resolve the active tenant from an AuthSession (multi-tenant picker)
//   or fall back to email domain lookup, then look up the TenantUser
//   record to determine role and status:
//
//   ACTIVE      → inject custom:tenantId + custom:role from TenantUser.role
//   PENDING     → first login: inject role, set status=ACTIVE + activatedAt + cognitoSub
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
    // No-group admin users — allow token issuance with no custom claims.
    //
    // This covers the admin setup flow: the create-admin-user script must
    // authenticate to obtain an access token for TOTP enrollment *before*
    // the user is added to PLATFORM_ADMIN. Without any group membership the
    // user receives an empty token (no custom:role, no custom:tenantId)
    // which is useless for API access but sufficient for Cognito TOTP
    // association.
    // -----------------------------------------------------------------------
    if (groups.length === 0) {
      logger.info(
        'Pre-Token trigger: Admin user has no groups — issuing token without custom claims',
        {
          userName: event.userName,
        },
      )
      return event
    }

    // -----------------------------------------------------------------------
    // ADMIN APP CLIENT — inject platform_admin role, no tenant resolution.
    // -----------------------------------------------------------------------
    event.response = {
      claimsOverrideDetails: {
        claimsToAddOrOverride: {
          'custom:role': 'platform_admin',
        },
      },
    }
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

  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) {
    logger.error('Pre-Token trigger: Invalid email format', { email })
    throw new Error('Authentication failed: Invalid email format')
  }

  // -------------------------------------------------------------------------
  // Step 1: Check for a pending AuthSession (created by POST /api/auth/select-tenant).
  // If found, use its tenantId — this bypasses the email domain restriction,
  // enabling cross-org users (contractors, invited users with different domains).
  // -------------------------------------------------------------------------
  const authSession = await db.authSession.findFirst({
    where: { email, expiresAt: { gt: new Date() } },
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
  const tenantUser = await db.tenantUser.findUnique({
    where: { tenantId_email: { tenantId, email } },
    select: { id: true, role: true, status: true },
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

  // Map TenantUserRole to the claim string used throughout the API.
  const roleClaimValue = tenantUser.role === 'ADMIN' ? 'tenant_admin' : 'tenant_user'

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
      role: tenantUser.role,
    })
  }

  event.response = {
    claimsOverrideDetails: {
      claimsToAddOrOverride: {
        'custom:tenantId': tenantId,
        'custom:role': roleClaimValue,
      },
    },
  }

  return event
}
