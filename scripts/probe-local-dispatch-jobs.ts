#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Probe a tenant's LocalDispatchJobs for the driver-itinerary read model.
//
// The itinerary turns each local job's `services` string into one item per
// token and derives a place for it. Both depend on how the tenant actually
// fills the row, which no repository records — so this is how you check, per
// tenant, before relying on it (plan: driver-itinerary, Phase 0).
//
// Usage (needs `aws sso login --sso-session dolas` first):
//
//   npx tsx scripts/probe-local-dispatch-jobs.ts <tenant-id> [--env prod|staging] [--days 90]
//
// Read-only: SELECTs against INFORMATION_SCHEMA, LocalDispatchJobs and
// Longhaul_ActivityType, nothing else.
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ENVS = {
  prod: {
    profile: 'dolas-pegasus-prod',
    secret: 'pegasus/prod/database-url',
    executor: 'pegasus-prod-wireguard-MssqlExecutorFn3A798014-YIjCagZfU22R',
  },
  staging: {
    profile: 'dolas-pegasus-staging',
    secret: 'pegasus/staging/database-url',
    executor: '',
  },
} as const

type EnvName = keyof typeof ENVS
type Row = Record<string, unknown>

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

function query(env: (typeof ENVS)[EnvName], executor: string, cs: string, sql: string): Row[] {
  const payload = JSON.stringify({ connectionString: cs, sql, timeoutMs: 25_000 })
  const dir = mkdtempSync(join(tmpdir(), 'probe-ldj-'))
  const outFile = join(dir, 'out.json')
  try {
    try {
      execFileSync(
        'aws',
        [
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
          outFile,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] },
      )
    } catch (err) {
      // The thrown message embeds the argv, which carries the connection
      // string and its password — never let it reach the terminal. That is
      // also why the caught error is NOT attached as `cause`.
      const stderr = String((err as { stderr?: unknown }).stderr ?? '').trim()
      // eslint-disable-next-line preserve-caught-error -- `cause` would carry the password (see above)
      throw new Error(`aws lambda invoke failed: ${stderr.split('\n').pop() ?? 'unknown error'}`)
    }
    const res = JSON.parse(readFileSync(outFile, 'utf8')) as
      { ok: true; recordset: Row[] } | { ok: false; code: string; error: string }
    if (!res.ok) throw new Error(`${res.code}: ${res.error}`)
    return res.recordset
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function section(title: string, rows: Row[]): void {
  console.log(`\n## ${title}`)
  if (rows.length === 0) console.log('  (no rows)')
  for (const r of rows) console.log('  ' + JSON.stringify(r))
}

function main(): void {
  const args = process.argv.slice(2)
  const tenantId = args.find(
    (a, i) => !a.startsWith('-') && !['--env', '--days'].includes(args[i - 1] ?? ''),
  )
  const envName = (args.includes('--env') ? args[args.indexOf('--env') + 1] : 'prod') as EnvName
  const days = Number(args.includes('--days') ? args[args.indexOf('--days') + 1] : 90)
  if (!tenantId || !(envName in ENVS) || !Number.isInteger(days) || days < 1) {
    console.error(
      'usage: npx tsx scripts/probe-local-dispatch-jobs.ts <tenant-id> [--env prod|staging] [--days 90]',
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
  if (tenantId === 'list') {
    console.log(
      sh('psql', [
        dbUrl,
        '-At',
        '-c',
        'SELECT id, name FROM tenants WHERE mssql_connection_string IS NOT NULL ORDER BY name',
      ]),
    )
    return
  }
  if (!/^[0-9a-zA-Z-]+$/.test(tenantId)) throw new Error('tenant id must be an id, not SQL')
  const cs = sh('psql', [
    dbUrl,
    '-At',
    '-c',
    `SELECT mssql_connection_string FROM tenants WHERE id = '${tenantId}'`,
  ])
  if (!cs) {
    console.error(`Tenant ${tenantId} has no mssql_connection_string in ${envName}.`)
    process.exit(1)
  }
  const executor = resolveExecutor(env)
  const q = (sql: string) => query(env, executor, cs, sql)
  const window = `j.service_date >= DATEADD(day, -${days}, CAST(GETDATE() AS date))`

  console.log(`tenant ${tenantId} (${envName}) — LocalDispatchJobs, last ${days} days`)

  section(
    'columns',
    q(
      `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH AS len FROM INFORMATION_SCHEMA.COLUMNS ` +
        `WHERE TABLE_NAME = 'LocalDispatchJobs' ORDER BY ORDINAL_POSITION`,
    ),
  )

  section(
    'fill rates',
    q(
      `SELECT COUNT(*) AS jobs,` +
        ` SUM(CASE WHEN ISNULL(j.driver_id1,0) <> 0 OR ISNULL(j.driver_id2,0) <> 0 THEN 1 ELSE 0 END) AS with_driver,` +
        ` SUM(CASE WHEN ISNULL(j.active,'Y') = 'N' THEN 1 ELSE 0 END) AS inactive,` +
        ` SUM(CASE WHEN j.is_final = 'Y' THEN 1 ELSE 0 END) AS final,` +
        ` SUM(CASE WHEN j.is_confirmed = 'Y' THEN 1 ELSE 0 END) AS confirmed,` +
        ` SUM(CASE WHEN LTRIM(RTRIM(ISNULL(j.services,''))) = '' THEN 1 ELSE 0 END) AS empty_services,` +
        ` SUM(CASE WHEN LTRIM(RTRIM(ISNULL(CAST(j.services_more AS nvarchar(max)),''))) <> '' THEN 1 ELSE 0 END) AS with_services_more,` +
        ` SUM(CASE WHEN j.services LIKE '%[^A-Z0-9 ]%' THEN 1 ELSE 0 END) AS services_odd_chars,` +
        ` SUM(CASE WHEN LTRIM(RTRIM(ISNULL(CAST(j.OriginLocation1 AS nvarchar(max)),''))) <> '' THEN 1 ELSE 0 END) AS with_origin_loc1,` +
        ` SUM(CASE WHEN LTRIM(RTRIM(ISNULL(CAST(j.DestinationLocation1 AS nvarchar(max)),''))) <> '' THEN 1 ELSE 0 END) AS with_dest_loc1,` +
        ` SUM(CASE WHEN j.service_at_orig = 'Y' THEN 1 ELSE 0 END) AS at_orig_y,` +
        ` SUM(CASE WHEN j.service_at_dest = 'Y' THEN 1 ELSE 0 END) AS at_dest_y,` +
        ` SUM(CASE WHEN j.start_time IS NOT NULL THEN 1 ELSE 0 END) AS with_start_time` +
        ` FROM LocalDispatchJobs j WHERE ${window}`,
    ),
  )

  // Token frequency. STRING_SPLIT needs compat level 130; the fallback below is
  // the raw distinct strings, which is enough to read the vocabulary by eye.
  try {
    section(
      'service tokens (space-split)',
      q(
        `SELECT t.value AS token, COUNT(*) AS n FROM LocalDispatchJobs j` +
          ` CROSS APPLY STRING_SPLIT(LTRIM(RTRIM(ISNULL(j.services,''))), ' ') t` +
          ` WHERE ${window} AND t.value <> '' GROUP BY t.value ORDER BY n DESC`,
      ),
    )
  } catch (err) {
    console.log(`\n(STRING_SPLIT unavailable: ${(err as Error).message}) — raw strings instead`)
    section(
      'distinct services strings',
      q(
        `SELECT TOP 60 j.services, COUNT(*) AS n FROM LocalDispatchJobs j WHERE ${window}` +
          ` GROUP BY j.services ORDER BY n DESC`,
      ),
    )
  }

  section(
    'odd services strings (sample)',
    q(
      `SELECT TOP 15 j.services, COUNT(*) AS n FROM LocalDispatchJobs j WHERE ${window}` +
        ` AND j.services LIKE '%[^A-Z0-9 ]%' GROUP BY j.services ORDER BY n DESC`,
    ),
  )

  section(
    'location samples',
    q(
      `SELECT TOP 8 j.services, j.service_at_orig, j.service_at_dest,` +
        ` LEFT(CAST(j.OriginLocation1 AS nvarchar(max)), 80) AS orig1, LEFT(CAST(j.OriginLocation2 AS nvarchar(max)), 80) AS orig2,` +
        ` LEFT(CAST(j.DestinationLocation1 AS nvarchar(max)), 80) AS dest1, LEFT(CAST(j.DestinationLocation2 AS nvarchar(max)), 80) AS dest2` +
        ` FROM LocalDispatchJobs j WHERE ${window} ORDER BY j.service_date DESC`,
    ),
  )

  section(
    'jobs per order per day (max)',
    q(
      `SELECT TOP 5 j.order_num, j.service_date, COUNT(*) AS jobs FROM LocalDispatchJobs j WHERE ${window}` +
        ` GROUP BY j.order_num, j.service_date HAVING COUNT(*) > 1 ORDER BY jobs DESC`,
    ),
  )

  section(
    'Longhaul_ActivityType',
    q(
      `SELECT code, abbreviation, name, isPerformedAtOrigin, isPerformedAtDestination, isHasETA, sequencePriority` +
        ` FROM Longhaul_ActivityType ORDER BY sequencePriority`,
    ),
  )
}

try {
  main()
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  if (/token has expired|NoCredentials|sso/i.test(msg)) {
    console.error('AWS credentials are not valid. Run: aws sso login --sso-session dolas')
  } else {
    console.error(msg)
  }
  process.exit(1)
}
