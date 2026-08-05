#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Verify LONGHAUL_SHIPMENT_VIEW_COLUMNS against a live tenant's view.
//
// The manifest in @pegasus/longhaul-contracts is checked in because CI has no
// MSSQL and the view is provisioned from a different repository. This script is
// how you confirm it still matches reality — run it when a tenant is
// provisioned, when the legacy ViewEntity changes, or when a field mysteriously
// renders blank.
//
// Usage (needs `aws sso login --sso-session dolas` first):
//
//   npx tsx scripts/verify-longhaul-view-columns.ts <tenant-id> [--env prod|staging] [--types]
//
//   --types   also print a column → INFORMATION_SCHEMA.DATA_TYPE mapping, the
//             input for refining LonghaulSqlValue into per-column scalars.
//
// Read-only: two SELECTs against INFORMATION_SCHEMA, nothing else. Exits 1 on
// any drift so it can gate a provisioning script.
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process'

import { LONGHAUL_SHIPMENT_VIEW_COLUMNS } from '@pegasus/longhaul-contracts'

const VIEW = 'v_longhaul_shipments_v2'

const ENVS = {
  prod: {
    profile: 'dolas-pegasus-prod',
    secret: 'pegasus/prod/database-url',
    executor: 'pegasus-prod-wireguard-MssqlExecutorFn3A798014-YIjCagZfU22R',
  },
  staging: {
    profile: 'dolas-pegasus-staging',
    secret: 'pegasus/staging/database-url',
    // Resolved at runtime — the staging function name carries a different suffix.
    executor: '',
  },
} as const

type EnvName = keyof typeof ENVS

function sh(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim()
}

function resolveExecutor(env: (typeof ENVS)[EnvName]): string {
  if (env.executor) return env.executor
  const out = sh('aws', [
    'lambda',
    'list-functions',
    '--profile',
    env.profile,
    '--region',
    'us-east-1',
    '--query',
    "Functions[?contains(FunctionName,'MssqlExecutor')].FunctionName",
    '--output',
    'text',
  ])
  const name = out.split(/\s+/).filter(Boolean)[0]
  if (!name) throw new Error(`No MssqlExecutor function found in ${env.profile}`)
  return name
}

/** Run one read-only statement through the in-VPC executor Lambda. */
function query(
  env: (typeof ENVS)[EnvName],
  executor: string,
  connectionString: string,
  sql: string,
): Array<Record<string, unknown>> {
  const payload = JSON.stringify({ connectionString, sql, timeoutMs: 20_000 })
  const out = sh('aws', [
    'lambda',
    'invoke',
    '--profile',
    env.profile,
    '--region',
    'us-east-1',
    '--function-name',
    executor,
    '--cli-binary-format',
    'raw-in-base64-out',
    '--payload',
    payload,
    '/dev/stdout',
  ])
  // `aws lambda invoke` writes the response body to the outfile and its own
  // status JSON to stdout; with /dev/stdout both land here, body first.
  const body = out.slice(0, out.lastIndexOf('}{') + 1) || out
  const res = JSON.parse(body) as
    | { ok: true; recordset: Array<Record<string, unknown>> }
    | { ok: false; code: string; error: string }
  if (!res.ok) throw new Error(`${res.code}: ${res.error}`)
  return res.recordset
}

function main(): void {
  const args = process.argv.slice(2)
  const tenantId = args.find((a) => !a.startsWith('-'))
  const envName = (args.includes('--env') ? args[args.indexOf('--env') + 1] : 'prod') as EnvName
  const wantTypes = args.includes('--types')

  if (!tenantId || !(envName in ENVS)) {
    console.error(
      'usage: npx tsx scripts/verify-longhaul-view-columns.ts <tenant-id> [--env prod|staging] [--types]',
    )
    process.exit(2)
  }
  const env = ENVS[envName]

  const dbUrl = sh('aws', [
    'secretsmanager',
    'get-secret-value',
    '--profile',
    env.profile,
    '--region',
    'us-east-1',
    '--secret-id',
    env.secret,
    '--query',
    'SecretString',
    '--output',
    'text',
  ])
  // The tenant table is `tenants` with snake_case columns — not Prisma's model name.
  const connectionString = sh('psql', [
    dbUrl,
    '-At',
    '-c',
    `SELECT mssql_connection_string FROM tenants WHERE id = '${tenantId}'`,
  ])
  if (!connectionString) {
    console.error(`Tenant ${tenantId} has no mssql_connection_string in ${envName}.`)
    process.exit(1)
  }

  const executor = resolveExecutor(env)
  const rows = query(
    env,
    executor,
    connectionString,
    `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS ` +
      `WHERE TABLE_NAME = '${VIEW}' ORDER BY ORDINAL_POSITION`,
  )

  if (rows.length === 0) {
    console.error(`${VIEW} does not exist on tenant ${tenantId} (${envName}).`)
    process.exit(1)
  }

  const live = rows.map((r) => String(r['COLUMN_NAME']))
  const manifest = [...LONGHAUL_SHIPMENT_VIEW_COLUMNS] as string[]
  const missing = manifest.filter((c) => !live.includes(c))
  const extra = live.filter((c) => !manifest.includes(c))

  console.log(
    `tenant ${tenantId} (${envName}) — ${VIEW}: ${live.length} columns live, ${manifest.length} in manifest`,
  )

  if (wantTypes) {
    console.log('\ncolumn → DATA_TYPE:')
    for (const r of rows)
      console.log(`  ${String(r['COLUMN_NAME']).padEnd(24)} ${String(r['DATA_TYPE'])}`)
  }

  if (missing.length === 0 && extra.length === 0) {
    console.log('\n✔ manifest matches the live view exactly')
    return
  }
  if (missing.length) console.error(`\n✘ in the manifest but NOT live: ${missing.join(', ')}`)
  if (extra.length) console.error(`✘ live but NOT in the manifest: ${extra.join(', ')}`)
  console.error(
    '\nA field reading one of the missing columns will render blank for this tenant. ' +
      'Update the manifest (and the row type) or fix the tenant view.',
  )
  process.exit(1)
}

try {
  main()
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  // The overwhelmingly common failure is an expired SSO session; a node stack
  // trace for that is noise.
  if (/token has expired|NoCredentials|sso/i.test(msg)) {
    console.error('AWS credentials are not valid. Run: aws sso login --sso-session dolas')
  } else {
    console.error(msg)
  }
  process.exit(1)
}
