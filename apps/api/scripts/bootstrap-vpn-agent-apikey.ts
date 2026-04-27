#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// One-shot bootstrap: provision the WireGuard hub agent's M2M ApiClient and
// stash its plain key in SSM at /pegasus/wireguard/agent/apikey.
//
// Run once per env (dev / staging / prod) BEFORE the first hub instance boot.
// The hub user-data fetches the SSM SecureString at boot; if the param is
// missing the agent install aborts and the ASG instance fails its launch.
//
// What this does:
//   1. Connect to the env's database via DIRECT_URL.
//   2. Pick (or accept --tenant <id>) a tenant to anchor the ApiClient row to.
//      The vpn:sync handler does not filter by tenant, so the choice is
//      effectively cosmetic — but the FK is required.
//   3. Pick (or accept --created-by <id>) a TenantUser as createdBy.
//   4. Create the ApiClient with name "VPN Hub Reconcile Agent" and
//      scopes ['vpn:sync']. The plaintext is shown once on creation.
//   5. Write the plaintext to SSM as a SecureString. Aborts if the param
//      already exists unless --force is passed.
//
// Usage:
//   AWS_PROFILE=pegasus-prod \
//   DIRECT_URL='postgresql://...' \
//   npx tsx apps/api/scripts/bootstrap-vpn-agent-apikey.ts
//
// Optional flags:
//   --tenant <id>        Skip the interactive tenant prompt
//   --created-by <id>    Skip the interactive user prompt
//   --force              Overwrite an existing SSM param (rotates the key)
//   --region <region>    AWS region (default: $AWS_REGION or us-east-1)
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  SSMClient,
  GetParameterCommand,
  PutParameterCommand,
  ParameterNotFound,
} from '@aws-sdk/client-ssm'

const SSM_PARAM = '/pegasus/wireguard/agent/apikey'
const CLIENT_NAME = 'VPN Hub Reconcile Agent'
const SCOPES = ['vpn:sync']

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

const ok = (msg: string) => console.log(`  ${GREEN}✓${RESET} ${msg}`)
const fail = (msg: string) => console.error(`  ${RED}✗${RESET} ${msg}`)
const warn = (msg: string) => console.log(`  ${YELLOW}!${RESET} ${msg}`)

function parseFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function generateApiKey(): { plainKey: string; keyPrefix: string; keyHash: string } {
  // Mirror apps/api/src/repositories/api-client.repository.ts: vnd_<48 hex>.
  const hex = crypto.randomBytes(24).toString('hex')
  const plainKey = `vnd_${hex}`
  const keyPrefix = plainKey.slice(0, 12)
  const keyHash = crypto.createHash('sha256').update(plainKey).digest('hex')
  return { plainKey, keyPrefix, keyHash }
}

async function main(): Promise<void> {
  const region = parseFlag('region') ?? process.env['AWS_REGION'] ?? 'us-east-1'
  const force = hasFlag('force')
  const tenantFlag = parseFlag('tenant')
  const createdByFlag = parseFlag('created-by')

  const connectionString = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL']
  if (!connectionString) {
    fail('DIRECT_URL (or DATABASE_URL) must be set so this script can reach the env database.')
    process.exit(1)
  }

  const ssm = new SSMClient({ region })
  const adapter = new PrismaPg({ connectionString })
  const db = new PrismaClient({ adapter })

  const rl = createInterface({ input: process.stdin, output: process.stdout })

  try {
    console.log(`\n${BOLD}Bootstrap VPN agent ApiClient + SSM key${RESET}\n`)
    ok(`Region: ${region}`)
    ok(`SSM param: ${SSM_PARAM}`)

    // ---- 1. SSM pre-check: refuse to clobber unless --force.
    const existing = await readExisting(ssm)
    if (existing !== null && !force) {
      fail(`SSM param ${SSM_PARAM} already exists. Re-run with --force to rotate.`)
      process.exit(1)
    }
    if (existing !== null) {
      warn(`SSM param exists. --force passed: the existing key will be replaced.`)
    }

    // ---- 2. Pick a tenant.
    const tenantId = await pickTenant(db, rl, tenantFlag)
    ok(`Tenant: ${tenantId}`)

    // ---- 3. Pick a TenantUser as createdBy.
    const createdById = await pickCreator(db, rl, tenantId, createdByFlag)
    ok(`Created by: ${createdById}`)

    // ---- 4. Generate + insert the ApiClient row.
    const { plainKey, keyPrefix, keyHash } = generateApiKey()
    const row = await db.apiClient.create({
      data: {
        tenantId,
        name: CLIENT_NAME,
        keyPrefix,
        keyHash,
        scopes: SCOPES,
        createdById,
      },
      select: { id: true, keyPrefix: true, scopes: true, createdAt: true },
    })
    ok(`ApiClient created: id=${row.id} prefix=${row.keyPrefix}`)

    // ---- 5. Write SSM SecureString.
    await ssm.send(
      new PutParameterCommand({
        Name: SSM_PARAM,
        Type: 'SecureString',
        Value: plainKey,
        Overwrite: existing !== null,
        Description: 'M2M API key for the WireGuard hub reconcile agent. vpn:sync scope only.',
      }),
    )
    ok(`SSM ${SSM_PARAM} written (SecureString)`)

    console.log(`
${GREEN}${BOLD}  Done.${RESET}

  ApiClient id : ${row.id}
  Key prefix   : ${row.keyPrefix}
  Scopes       : ${row.scopes.join(', ')}

  The plaintext key is now stored in SSM only — it is not echoed here on
  purpose. The next hub instance refresh will pick it up automatically.

${YELLOW}${BOLD}  If you ever need to rotate:${RESET} re-run this script with --force,
  then trigger an ASG instance refresh on pegasus-${BOLD}<env>${RESET}-wireguard.
`)
  } finally {
    rl.close()
    await db.$disconnect()
  }
}

async function readExisting(ssm: SSMClient): Promise<string | null> {
  try {
    const res = await ssm.send(new GetParameterCommand({ Name: SSM_PARAM, WithDecryption: false }))
    return res.Parameter?.Value ?? null
  } catch (err) {
    if (err instanceof ParameterNotFound) return null
    throw err
  }
}

async function pickTenant(
  db: PrismaClient,
  rl: ReturnType<typeof createInterface>,
  preset: string | undefined,
): Promise<string> {
  if (preset) {
    const found = await db.tenant.findUnique({ where: { id: preset }, select: { id: true } })
    if (!found) {
      fail(`Tenant ${preset} (from --tenant) not found.`)
      process.exit(1)
    }
    return found.id
  }

  const tenants = await db.tenant.findMany({
    select: { id: true, name: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  if (tenants.length === 0) {
    fail('No tenants in this database. Create one before bootstrapping the agent.')
    process.exit(1)
  }
  console.log('\n  Available tenants:')
  tenants.forEach((t, i) => {
    console.log(`    ${i + 1}. ${t.name}  (${t.id})`)
  })
  const pick = (await rl.question('\n  Pick a tenant by number: ')).trim()
  const idx = Number(pick) - 1
  const chosen = tenants[idx]
  if (!chosen) {
    fail(`Invalid choice: ${pick}`)
    process.exit(1)
  }
  return chosen.id
}

async function pickCreator(
  db: PrismaClient,
  rl: ReturnType<typeof createInterface>,
  tenantId: string,
  preset: string | undefined,
): Promise<string> {
  if (preset) {
    const found = await db.tenantUser.findFirst({
      where: { id: preset, tenantId },
      select: { id: true },
    })
    if (!found) {
      fail(`TenantUser ${preset} (from --created-by) not found in tenant ${tenantId}.`)
      process.exit(1)
    }
    return found.id
  }

  const users = await db.tenantUser.findMany({
    where: { tenantId },
    select: { id: true, email: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 25,
  })
  if (users.length === 0) {
    fail(`No TenantUser rows in tenant ${tenantId}. Create one first.`)
    process.exit(1)
  }
  console.log('\n  Available TenantUsers in this tenant (oldest 25):')
  users.forEach((u, i) => {
    console.log(`    ${i + 1}. ${u.email}  (${u.id})`)
  })
  const pick = (await rl.question('\n  Pick a creator by number: ')).trim()
  const idx = Number(pick) - 1
  const chosen = users[idx]
  if (!chosen) {
    fail(`Invalid choice: ${pick}`)
    process.exit(1)
  }
  return chosen.id
}

main().catch((err: unknown) => {
  console.error(`\n${RED}Fatal error:${RESET}`, err instanceof Error ? err.message : err)
  process.exit(1)
})
