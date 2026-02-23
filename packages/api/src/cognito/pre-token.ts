// ---------------------------------------------------------------------------
// Cognito Pre-Token-Generation Lambda trigger
//
// Injects custom claims (custom:tenantId, custom:role) into the ID token
// when a user authenticates. The backend middleware relies on these claims
// so it does not have to re-evaluate tenant mappings on every API request.
// ---------------------------------------------------------------------------

import type { PreTokenGenerationTriggerHandler } from 'aws-lambda'
import { PrismaClient } from '@prisma/client'

// Use a shared client to pool connections across warm invocations.
const db = new PrismaClient()

export const handler: PreTokenGenerationTriggerHandler = async (event) => {
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

  // 1. Resolve active tenant for this email domain
  const tenant = await db.tenant.findFirst({
    where: {
      emailDomains: { has: domain },
      status: 'ACTIVE',
    },
    select: { id: true },
  })

  // Fail-closed: No active tenant means no session.
  if (!tenant) {
    console.warn(`Pre-Token trigger: No active tenant for domain ${domain}`)
    throw new Error('Your email domain is not associated with any active Pegasus tenant. Contact your administrator.')
  }

  // 2. Inject custom claims
  event.response = {
    claimsOverrideDetails: {
      claimsToAddOrOverride: {
        'custom:tenantId': tenant.id,
        // Default role until phase 6 (per-user RBAC mapping)
        'custom:role': 'tenant_user',
      },
    },
  }

  return event
}
