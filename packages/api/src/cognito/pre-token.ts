// ---------------------------------------------------------------------------
// Cognito Pre-Token-Generation Lambda trigger
//
// Injects custom claims into the ID token after successful authentication.
// The backend middleware relies on these claims so it does not have to
// re-evaluate context on every API request.
//
// PLATFORM_ADMIN users: inject custom:role = 'platform_admin' only.
//   No tenant lookup — admins are not associated with any tenant.
//
// Tenant users: resolve the active tenant from the email domain, then look up
//   the TenantUser record to determine role and status:
//
//   ACTIVE    → inject custom:tenantId + custom:role from TenantUser.role
//   PENDING   → first login: inject role, then set status=ACTIVE + activatedAt + cognitoSub
//   DEACTIVATED → block token generation (fail-closed)
//   Not found → block token generation (strict invite-only — no JIT provisioning)
// ---------------------------------------------------------------------------

import type { PreTokenGenerationTriggerHandler } from 'aws-lambda'
import { PrismaClient } from '@prisma/client'
import { createLogger } from '../lib/logger'

const logger = createLogger('pegasus-pre-token')

// Use a shared client to pool connections across warm invocations.
const db = new PrismaClient()

const PLATFORM_ADMIN_GROUP = 'PLATFORM_ADMIN'

export const handler: PreTokenGenerationTriggerHandler = async (event) => {
  const groups: string[] = event.request.groupConfiguration?.groupsToOverride ?? []

  // -------------------------------------------------------------------------
  // Platform admins — skip tenant lookup, inject role claim only.
  // -------------------------------------------------------------------------
  if (groups.includes(PLATFORM_ADMIN_GROUP)) {
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
  // Tenant users — resolve tenant via AuthSession (multi-tenant picker) or
  // fall back to email domain lookup (single-tenant / backward compat).
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
    // -------------------------------------------------------------------------
    // Step 2: No pending session — fall back to email domain resolution.
    // This is the original single-tenant flow. Zero behaviour change for users
    // who never hit the tenant picker.
    // -------------------------------------------------------------------------
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
