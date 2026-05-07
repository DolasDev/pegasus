#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// One-shot backfill: provision an AVP policy store for every tenant whose
// `policy_store_id` is still NULL.
//
// Why: tenants created before the Cedar/AVP foundation merged (or before
// COGNITO_USER_POOL_ARN / COGNITO_TENANT_CLIENT_ID were wired into the API
// stack) fall through `pickBackend()` to the offline cedar-wasm path.
// Functionally correct — same policies and schema — but it defeats the
// per-tenant store isolation, leaves no AVP CloudTrail audit trail for
// those tenants, and means policy edits made via the AVP console don't take
// effect for legacy tenants.
//
// Idempotent: tenants that already have a policy_store_id are skipped.
//
// Usage:
//   AWS_PROFILE=pegasus-staging AWS_REGION=us-east-1 \
//   DATABASE_URL='postgres://...' \
//   COGNITO_USER_POOL_ARN='arn:aws:cognito-idp:...' \
//   COGNITO_TENANT_CLIENT_ID='...' \
//     npx tsx apps/api/src/scripts/backfill-policy-stores.ts [--apply]
//
// Default is dry-run; pass `--apply` to actually provision and write.
//
// AVP soft limit ~100 stores per account: the script lists existing stores
// first and aborts if `existing + tenantsToBackfill > 90`. Raise the limit
// via AWS support before re-running if that fires.
// ---------------------------------------------------------------------------

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  VerifiedPermissionsClient,
  ListPolicyStoresCommand,
} from '@aws-sdk/client-verifiedpermissions'
import { provisionTenantPolicyStore } from '../lib/authz-provision'

const APPLY = process.argv.includes('--apply')

const STORE_SOFT_LIMIT_GUARD = 90

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL']
  const userPoolArn = process.env['COGNITO_USER_POOL_ARN']
  const tenantAppClientId = process.env['COGNITO_TENANT_CLIENT_ID']

  if (!databaseUrl) throw new Error('DATABASE_URL is required')
  if (!userPoolArn) throw new Error('COGNITO_USER_POOL_ARN is required')
  if (!tenantAppClientId) throw new Error('COGNITO_TENANT_CLIENT_ID is required')

  const adapter = new PrismaPg({ connectionString: databaseUrl })
  const db = new PrismaClient({ adapter })
  const avp = new VerifiedPermissionsClient({})

  console.log(APPLY ? '=== APPLYING BACKFILL ===' : '=== DRY RUN ===')

  const tenants = await db.tenant.findMany({
    where: { policyStoreId: null },
    select: { id: true, slug: true, name: true, status: true },
    orderBy: { slug: 'asc' },
  })

  console.log(`Tenants needing backfill: ${tenants.length}`)
  for (const t of tenants) {
    console.log(`  - ${t.slug} (${t.id}) [${t.status}] ${t.name}`)
  }

  if (tenants.length === 0) {
    console.log('Nothing to do.')
    await db.$disconnect()
    return
  }

  // Soft-limit guard. ListPolicyStores paginates; count by walking through.
  let existingStores = 0
  let nextToken: string | undefined
  do {
    const page = await avp.send(new ListPolicyStoresCommand({ nextToken, maxResults: 50 }))
    existingStores += (page.policyStores ?? []).length
    nextToken = page.nextToken
  } while (nextToken)

  const projectedTotal = existingStores + tenants.length
  console.log(`AVP stores in account: ${existingStores}; after backfill: ${projectedTotal}`)
  if (projectedTotal > STORE_SOFT_LIMIT_GUARD) {
    throw new Error(
      `Projected store count ${projectedTotal} would exceed soft-limit guard (${STORE_SOFT_LIMIT_GUARD}). ` +
        'File an AWS support ticket to raise the AVP per-account store limit before re-running.',
    )
  }

  if (!APPLY) {
    console.log('Dry-run complete. Re-run with --apply to provision.')
    await db.$disconnect()
    return
  }

  let provisioned = 0
  let failed = 0
  for (const t of tenants) {
    try {
      const result = await provisionTenantPolicyStore({
        tenantSlug: t.slug,
        userPoolArn,
        tenantAppClientId,
      })
      await db.tenant.update({
        where: { id: t.id },
        data: { policyStoreId: result.policyStoreId },
      })
      console.log(`  ✓ ${t.slug} → ${result.policyStoreId}`)
      provisioned++
    } catch (err) {
      console.error(`  ✗ ${t.slug} FAILED: ${err instanceof Error ? err.message : String(err)}`)
      failed++
    }
  }

  console.log('=== Backfill complete ===')
  console.log(`  provisioned: ${provisioned}`)
  console.log(`  failed:      ${failed}`)

  const remaining = await db.tenant.count({ where: { policyStoreId: null } })
  console.log(`  tenants still NULL after run: ${remaining}`)
  await db.$disconnect()

  if (failed > 0 || remaining > 0) {
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
