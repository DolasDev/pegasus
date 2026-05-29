#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Audit Cognito users for case-sensitivity drift.
//
// Why this exists
// ---------------
// The Cognito user pool was created with the CDK default `signInCaseSensitive`
// = true and that setting is immutable per pool. Earlier code paths passed the
// inviter-typed email straight through to AdminCreateUser, so the pool may
// hold users with mixed-case usernames (e.g. `John@Acme.com`). Provisioning
// and login were retro-fitted to lowercase before any Cognito call, so any
// such users are now unreachable via the normalised login path — this script
// finds them so an admin can re-invite them with the canonical lowercase form.
//
// Usage:
//   COGNITO_USER_POOL_ID=us-east-1_xxx \
//   AWS_REGION=us-east-1 \
//   DATABASE_URL=postgres://... \
//     npx tsx scripts/audit-cognito-case.ts
//
// Output: one line per affected user with username, email attribute, Cognito
// status, sub, and (if found in our DB) the tenant + roster status. Exit code
// 0 always — this is a read-only audit.
//
// Remediation (manual, per affected user — none of this is automated because
// recreating a Cognito user mints a new `sub`, which a downstream operator
// must understand before performing):
//
//   1. POST  /api/admin/tenants/:tenantId/users   (re-invite with lowercase
//                                                   email — idempotent on the
//                                                   roster; Cognito will reject
//                                                   the duplicate email)
//   2. Run `aws cognito-idp admin-delete-user ...` against the mixed-case
//      Username to free the address (this is destructive — the user must not
//      have meaningful Cognito-side state).
//   3. Re-run the invite from step 1; the temp-password email goes out and
//      the next login provisions a fresh sub via the pre-token trigger.
// ---------------------------------------------------------------------------

import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

interface AffectedUser {
  username: string
  emailAttr: string | null
  status: string | undefined
  sub: string | null
}

function attr(user: UserType, name: string): string | null {
  return user.Attributes?.find((a) => a.Name === name)?.Value ?? null
}

function hasUppercase(s: string | null | undefined): boolean {
  return typeof s === 'string' && /[A-Z]/.test(s)
}

async function listAllCognitoUsers(
  cognito: CognitoIdentityProviderClient,
  userPoolId: string,
): Promise<UserType[]> {
  const out: UserType[] = []
  let token: string | undefined
  do {
    const res = await cognito.send(
      new ListUsersCommand({ UserPoolId: userPoolId, PaginationToken: token, Limit: 60 }),
    )
    if (res.Users) out.push(...res.Users)
    token = res.PaginationToken
  } while (token)
  return out
}

async function main(): Promise<void> {
  const userPoolId = process.env['COGNITO_USER_POOL_ID']
  if (!userPoolId) {
    console.error('COGNITO_USER_POOL_ID is required')
    process.exit(1)
  }
  const connectionString = process.env['DATABASE_URL']
  if (!connectionString) {
    console.error('DATABASE_URL is required (used to cross-reference TenantUser rows)')
    process.exit(1)
  }

  const cognito = new CognitoIdentityProviderClient({})
  const adapter = new PrismaPg({ connectionString })
  const db = new PrismaClient({ adapter })

  console.log(`Listing users in pool ${userPoolId}...`)
  const users = await listAllCognitoUsers(cognito, userPoolId)
  console.log(`Total Cognito users: ${users.length}`)

  const affected: AffectedUser[] = users
    .filter((u) => hasUppercase(u.Username) || hasUppercase(attr(u, 'email')))
    .map((u) => ({
      username: u.Username ?? '(no username)',
      emailAttr: attr(u, 'email'),
      status: u.UserStatus,
      sub: attr(u, 'sub'),
    }))

  console.log(`Mixed-case users: ${affected.length}`)
  if (affected.length === 0) {
    console.log('✓ No remediation needed — pool is fully lowercase.')
    await db.$disconnect()
    return
  }

  console.log('')
  console.log('Affected users (mixed-case Username or email attribute):')
  console.log('')

  for (const u of affected) {
    // The roster lookup is case-insensitive in the schema usage below, so it
    // surfaces existing TenantUser rows whether they were stored as the
    // mixed-case original or the lowercase form.
    const lookupEmail = (u.emailAttr ?? u.username).toLowerCase()
    const rosterRows = await db.tenantUser.findMany({
      where: { email: { equals: lookupEmail, mode: 'insensitive' } },
      select: {
        tenantId: true,
        status: true,
        cognitoSub: true,
        tenant: { select: { name: true } },
      },
    })

    console.log(`  Username:   ${u.username}`)
    console.log(`  email attr: ${u.emailAttr ?? '(none)'}`)
    console.log(`  status:     ${u.status ?? '(unknown)'}`)
    console.log(`  sub:        ${u.sub ?? '(none)'}`)
    if (rosterRows.length === 0) {
      console.log('  roster:     (no TenantUser row — Cognito-only / orphan)')
    } else {
      for (const r of rosterRows) {
        const subFlag = r.cognitoSub === u.sub ? ' ← linked' : ''
        console.log(
          `  roster:     tenant=${r.tenant.name} (${r.tenantId}) status=${r.status}` +
            ` cognitoSub=${r.cognitoSub ?? 'null'}${subFlag}`,
        )
      }
    }
    console.log('')
  }

  console.log(
    `Done. See file header for remediation steps. Affected: ${affected.length}/${users.length}.`,
  )

  await db.$disconnect()
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
