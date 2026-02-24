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
// Tenant users: resolve the active tenant from the email domain and inject
//   custom:tenantId + custom:role = 'tenant_user'.
// ---------------------------------------------------------------------------

import type { PreTokenGenerationTriggerHandler } from 'aws-lambda'
import { PrismaClient } from '@prisma/client'

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
  // Tenant users — resolve tenant from email domain.
  // -------------------------------------------------------------------------
  const email = event.request.userAttributes.email

  if (!email) {
    console.error('Pre-Token trigger: Missing email claim')
    throw new Error('Authentication failed: No email associated with identity')
  }

  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) {
    console.error(`Pre-Token trigger: Invalid email format ${email}`)
    throw new Error('Authentication failed: Invalid email format')
  }

  const tenant = await db.tenant.findFirst({
    where: {
      emailDomains: { has: domain },
      status: 'ACTIVE',
    },
    select: { id: true },
  })

  // Fail-closed: no active tenant means no session.
  if (!tenant) {
    console.warn(`Pre-Token trigger: No active tenant for domain ${domain}`)
    throw new Error(
      'Your email domain is not associated with any active Pegasus tenant. Contact your administrator.',
    )
  }

  event.response = {
    claimsOverrideDetails: {
      claimsToAddOrOverride: {
        'custom:tenantId': tenant.id,
        'custom:role': 'tenant_user',
      },
    },
  }

  return event
}
