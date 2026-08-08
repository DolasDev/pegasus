#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// One-off repair for trip roll-ups zeroed by the summary-column bug.
//
// The cloud-direct summary recompute summed `total_actual_wt` and counted
// super-VIPs via `supervip` — neither is a column on v_longhaul_shipments_v2 —
// and read the state ids off nested objects the view never projects. Each
// resolved to undefined, so every recompute wrote 0/0/null over correct legacy
// values. The recompute only runs on write, so affected trips do NOT self-heal;
// they stay wrong until someone next saves them. This backfills them.
//
// The code fix must be deployed FIRST. Otherwise the next save of any repaired
// trip zeroes it straight back out.
//
// Usage (needs `aws sso login --sso-session dolas` first):
//
//   npx tsx scripts/backfill-trip-summary-actuals.ts <tenant-id> [--env prod|staging] [--apply]
//
//   (default)  dry run — prints exactly which trips would change, and to what
//   --apply    performs the UPDATE, in batches, after printing the same preview
//
// Only ever touches trips where the stored value is 0/null AND the recomputed
// value is non-null — it repairs, and never overwrites a value that already
// looks computed. total_estimated_lbs and the linehaul columns are left alone;
// they were never broken.
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ENVS = {
  prod: { profile: 'dolas-pegasus-prod', secret: 'pegasus/prod/database-url' },
  staging: { profile: 'dolas-pegasus-staging', secret: 'pegasus/staging/database-url' },
} as const

type EnvName = keyof typeof ENVS

/** Trips per UPDATE. The executor caps a statement at ~15s; this stays well under. */
const BATCH_SIZE = 100

/**
 * Strip anything credential-shaped out of a string. execFileSync puts the whole
 * argv into the thrown error's `message` AND `stack`, and for a lambda invoke
 * that argv contains the payload — which carries the MSSQL password. Without
 * this, one failed call prints the prod DB credential to the terminal (and into
 * whatever captures it).
 */
function redact(text: string): string {
  return text
    .replace(/Password=[^;"\\]*/gi, 'Password=***')
    .replace(/"connectionString"\s*:\s*"[^"]*"/g, '"connectionString":"***"')
}

function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
  } catch (err) {
    // Scrub the original in place before attaching it as `cause`, so the error
    // chain is preserved without the credential riding along in it.
    if (err instanceof Error) {
      err.message = redact(err.message)
      if (err.stack) err.stack = redact(err.stack)
    }
    const stderr = redact(String((err as { stderr?: string }).stderr ?? ''))
    const status = (err as { status?: number }).status ?? '?'
    throw new Error(`${cmd} failed (${status}): ${stderr}`, { cause: err })
  }
}

function resolveExecutor(profile: string): string {
  const out = sh('aws', [
    'lambda',
    'list-functions',
    '--profile',
    profile,
    '--region',
    'us-east-1',
    '--query',
    "Functions[?contains(FunctionName,'MssqlExecutor')].FunctionName",
    '--output',
    'text',
  ])
  const name = out.split(/\s+/).filter(Boolean)[0]
  if (!name) throw new Error(`No MssqlExecutor function found in ${profile}`)
  return name
}

function query(
  profile: string,
  executor: string,
  connectionString: string,
  sql: string,
): Array<Record<string, unknown>> {
  const payload = JSON.stringify({ connectionString, sql, timeoutMs: 14_000 })
  // A real temp file, not /dev/stdout: the AWS CLI cannot open /dev/stdout when
  // this process's stdout is a pipe rather than a terminal.
  const dir = mkdtempSync(join(tmpdir(), 'pegasus-backfill-'))
  const outfile = join(dir, 'response.json')
  try {
    sh('aws', [
      'lambda',
      'invoke',
      '--profile',
      profile,
      '--region',
      'us-east-1',
      '--function-name',
      executor,
      '--cli-binary-format',
      'raw-in-base64-out',
      '--payload',
      payload,
      outfile,
    ])
    const res = JSON.parse(readFileSync(outfile, 'utf8')) as
      | { ok: true; recordset: Array<Record<string, unknown>> }
      | { ok: false; code: string; error: string }
    if (!res.ok) throw new Error(`${res.code}: ${res.error}`)
    return res.recordset
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// The roll-up, expressed in SQL exactly as computeTripSummary expresses it in JS:
// sum `weight` over LOAD/R19O activities only; super-VIP via `idc_break`; state
// ids by resolving the first/last activity's shipment geo codes.
const RECOMPUTE_CTE = `
WITH loads AS (
  SELECT a.TripMaster_id AS trip_id,
         SUM(CAST(ISNULL(s.weight, 0) AS bigint)) AS actual_lbs
  FROM LongDistanceDispatchActivity a
  JOIN v_longhaul_shipments_v2 s ON s.order_num = a.order_num
  WHERE a.ActivityType_code IN ('LOAD', 'R19O')
  GROUP BY a.TripMaster_id
),
supervips AS (
  SELECT a.TripMaster_id AS trip_id,
         COUNT(DISTINCT a.order_num) AS supervip_count
  FROM LongDistanceDispatchActivity a
  JOIN v_longhaul_shipments_v2 s ON s.order_num = a.order_num
  WHERE s.idc_break = 'Y'
  GROUP BY a.TripMaster_id
),
ends AS (
  SELECT a.TripMaster_id AS trip_id, s.shipper_state, s.consignee_state,
    ROW_NUMBER() OVER (PARTITION BY a.TripMaster_id
      ORDER BY COALESCE(a.actual_date, a.estimated_date, a.planned_start) ASC) AS rn_first,
    ROW_NUMBER() OVER (PARTITION BY a.TripMaster_id
      ORDER BY COALESCE(a.actual_date, a.estimated_date, a.planned_end) DESC) AS rn_last
  FROM LongDistanceDispatchActivity a
  JOIN v_longhaul_shipments_v2 s ON s.order_num = a.order_num
),
computed AS (
  SELECT t.id AS trip_id,
         t.total_actual_lbs AS stored_lbs,
         t.supervip_count   AS stored_supervip,
         t.origin_state_id  AS stored_origin,
         t.destination_state_id AS stored_dest,
         ISNULL(l.actual_lbs, 0) AS new_lbs,
         ISNULL(sv.supervip_count, 0) AS new_supervip,
         os.id AS new_origin,
         ds.id AS new_dest
  FROM TripMaster t
  LEFT JOIN loads l  ON l.trip_id = t.id
  LEFT JOIN supervips sv ON sv.trip_id = t.id
  LEFT JOIN ends ef ON ef.trip_id = t.id AND ef.rn_first = 1
  LEFT JOIN ends el ON el.trip_id = t.id AND el.rn_last = 1
  LEFT JOIN v_longhaul_states os ON os.geo_code = LTRIM(RTRIM(ef.shipper_state))
  LEFT JOIN v_longhaul_states ds ON ds.geo_code = LTRIM(RTRIM(el.consignee_state))
),
-- Repair only: each column changes only where it is currently empty and the
-- recomputed value is real. A trip already holding a correct legacy value is
-- left untouched.
targets AS (
  SELECT *,
    CASE WHEN ISNULL(stored_lbs, 0) = 0 AND new_lbs > 0 THEN 1 ELSE 0 END AS fix_lbs,
    CASE WHEN ISNULL(stored_supervip, 0) = 0 AND new_supervip > 0 THEN 1 ELSE 0 END AS fix_supervip,
    CASE WHEN stored_origin IS NULL AND new_origin IS NOT NULL THEN 1 ELSE 0 END AS fix_origin,
    CASE WHEN stored_dest IS NULL AND new_dest IS NOT NULL THEN 1 ELSE 0 END AS fix_dest
  FROM computed
)
`

const PREVIEW_SQL = `${RECOMPUTE_CTE}
SELECT trip_id, stored_lbs, new_lbs, stored_supervip, new_supervip,
       stored_origin, new_origin, stored_dest, new_dest,
       fix_lbs, fix_supervip, fix_origin, fix_dest
FROM targets
WHERE fix_lbs = 1 OR fix_supervip = 1 OR fix_origin = 1 OR fix_dest = 1
ORDER BY trip_id`

const updateSql = (ids: number[]): string => `${RECOMPUTE_CTE}
UPDATE t SET
  total_actual_lbs     = CASE WHEN g.fix_lbs = 1      THEN g.new_lbs      ELSE t.total_actual_lbs END,
  supervip_count       = CASE WHEN g.fix_supervip = 1 THEN g.new_supervip ELSE t.supervip_count END,
  origin_state_id      = CASE WHEN g.fix_origin = 1   THEN g.new_origin   ELSE t.origin_state_id END,
  destination_state_id = CASE WHEN g.fix_dest = 1     THEN g.new_dest     ELSE t.destination_state_id END,
  updated_date = GETDATE()
FROM TripMaster t
JOIN targets g ON g.trip_id = t.id
WHERE t.id IN (${ids.join(', ')})
  AND (g.fix_lbs = 1 OR g.fix_supervip = 1 OR g.fix_origin = 1 OR g.fix_dest = 1);
SELECT @@ROWCOUNT AS updated`

function main(): void {
  const args = process.argv.slice(2)
  const tenantId = args.find((a) => !a.startsWith('-'))
  const envName = (args.includes('--env') ? args[args.indexOf('--env') + 1] : 'prod') as EnvName
  const apply = args.includes('--apply')

  if (!tenantId || !(envName in ENVS)) {
    console.error(
      'usage: npx tsx scripts/backfill-trip-summary-actuals.ts <tenant-id> [--env prod|staging] [--apply]',
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

  const executor = resolveExecutor(env.profile)
  console.log(`${envName} / tenant ${tenantId} — computing affected trips…\n`)

  const rows = query(env.profile, executor, connectionString, PREVIEW_SQL)
  if (rows.length === 0) {
    console.log('Nothing to repair.')
    return
  }

  const n = (r: Record<string, unknown>, k: string): number => Number(r[k] ?? 0)
  const counts = {
    lbs: rows.filter((r) => n(r, 'fix_lbs') === 1).length,
    supervip: rows.filter((r) => n(r, 'fix_supervip') === 1).length,
    origin: rows.filter((r) => n(r, 'fix_origin') === 1).length,
    dest: rows.filter((r) => n(r, 'fix_dest') === 1).length,
  }
  const lostLbs = rows
    .filter((r) => n(r, 'fix_lbs') === 1)
    .reduce((acc, r) => acc + n(r, 'new_lbs'), 0)

  console.log(`${rows.length} trips would change:`)
  console.log(`  total_actual_lbs      ${counts.lbs} trips  (${lostLbs.toLocaleString()} lbs)`)
  console.log(`  supervip_count        ${counts.supervip} trips`)
  console.log(`  origin_state_id       ${counts.origin} trips`)
  console.log(`  destination_state_id  ${counts.dest} trips\n`)

  // Only ever print the columns the guard will actually write. The recompute
  // also produces values for columns that are staying put (a trip whose stored
  // state id disagrees with today's shipments, say) — showing those as "a → b"
  // would misrepresent this as a much bigger write than it is.
  console.log('First 20 (only the columns that will be written):')
  for (const r of rows.slice(0, 20)) {
    const changes: string[] = []
    if (n(r, 'fix_lbs') === 1) changes.push(`lbs ${r['stored_lbs']} → ${r['new_lbs']}`)
    if (n(r, 'fix_supervip') === 1) {
      changes.push(`supervip ${r['stored_supervip']} → ${r['new_supervip']}`)
    }
    if (n(r, 'fix_origin') === 1) changes.push(`origin null → ${r['new_origin']}`)
    if (n(r, 'fix_dest') === 1) changes.push(`dest null → ${r['new_dest']}`)
    console.log(`  trip ${String(r['trip_id']).padStart(6)}  ${changes.join('  ')}`)
  }
  if (rows.length > 20) console.log(`  … and ${rows.length - 20} more`)

  // Values this backfill deliberately leaves alone, so the number is visible
  // rather than buried: a stored non-empty value always wins.
  const disagree = rows.filter(
    (r) =>
      (n(r, 'fix_lbs') === 0 && n(r, 'stored_lbs') !== n(r, 'new_lbs')) ||
      (n(r, 'fix_origin') === 0 && r['stored_origin'] !== r['new_origin']),
  ).length
  if (disagree > 0) {
    console.log(
      `\nNote: ${disagree} of these trips also hold a non-empty value that differs from ` +
        `today's recompute. Those are NOT touched — only empty columns are filled.`,
    )
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to perform the update.')
    return
  }

  const ids = rows.map((r) => Number(r['trip_id']))
  console.log(`\nApplying in batches of ${BATCH_SIZE}…`)
  let total = 0
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE)
    const res = query(env.profile, executor, connectionString, updateSql(batch))
    const updated = Number(res[0]?.['updated'] ?? 0)
    total += updated
    console.log(`  batch ${i / BATCH_SIZE + 1}: ${updated} trips updated`)
  }
  console.log(`\nDone — ${total} trips repaired.`)
}

main()
