#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Dogfood: push the built-in integration configs (longhaul + weichert) through
// the real publish path as GLOBAL `IntegrationConfig` rows.
//
// This is the Phase-3/4 vehicle of plans/todo/integration-config-dogfood-publish.md.
// It changes NEITHER the engine nor the built-ins — it just assembles the
// editable surface (mapping + rules) from the built-in code and the golden
// corpus from the Phase-1 exports, and drives the existing HTTP endpoints:
//
//   POST /api/v1/integrations/:id/config/validate   (dry-run gate, no write)
//   POST /api/v1/integrations/:id/config            (gate -> publish, flag-gated)
//   GET  /api/v1/integrations/:id/config            (active config for the scope)
//   GET  /api/v1/integrations/:id/config/versions   (version history)
//   POST /api/v1/integrations/:id/validate          (verify the live overlay)
//
// Publishing GLOBAL is derived server-side from the caller's tenant: authenticate
// with a `vnd_` key whose tenant is the PLATFORM tenant (isPlatformTenant=true)
// and carries Actions.PublishIntegrationConfig. Visibility = GLOBAL automatically.
//
// Usage (commands are single-line):
//   API_BASE_URL=https://<api> PEGASUS_PUBLISH_KEY=vnd_xxx npx tsx scripts/publish-builtin-configs.ts            # dry-run gate (default, no write)
//   API_BASE_URL=https://<api> PEGASUS_PUBLISH_KEY=vnd_xxx npx tsx scripts/publish-builtin-configs.ts --publish  # gate then publish GLOBAL
//   API_BASE_URL=https://<api> PEGASUS_PUBLISH_KEY=vnd_xxx npx tsx scripts/publish-builtin-configs.ts --verify   # GET config/versions + replay full corpus through /validate, diff vs expected
//   ... --publish --verify                                                                                       # publish, then verify in one run
//   ... longhaul                                                                                                 # limit to one integration (positional)
//
// Env:
//   API_BASE_URL  (or PEGASUS_API_BASE_URL) — API origin, e.g. https://api.pegasus-qa.dolas.dev  (no trailing /api/v1)
//   PEGASUS_PUBLISH_KEY  (or PEGASUS_VND_KEY) — the platform-tenant vnd_ key (sent as `Authorization: Bearer <key>`)
//
// Idempotent in spirit: a re-run just bumps the version (prior PUBLISHED -> SUPERSEDED).
// Exit code is non-zero if any gate fails, any publish errors, or --verify finds a diff.
// ---------------------------------------------------------------------------

import { weichertMapping } from '../src/integration-validation/transform/weichert.transform'
import { weichertRules } from '../src/integration-validation/rules/weichert.rules'
import { getBuiltinCorpus, getGateCorpus } from '../src/integration-validation/corpus'
import type { GateCorpusCase, GateReport } from '../src/integration-validation/gate-pipeline'

interface BuiltinConfig {
  id: string
  mapping: unknown
  rules: unknown
}

const BUILTINS: BuiltinConfig[] = [
  { id: 'weichert', mapping: weichertMapping, rules: weichertRules },
]

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const doPublish = args.includes('--publish')
const doVerify = args.includes('--verify')
const only = args.find((a) => !a.startsWith('--'))

const apiBase = (process.env['API_BASE_URL'] ?? process.env['PEGASUS_API_BASE_URL'] ?? '').replace(
  /\/+$/,
  '',
)
const publishKey = process.env['PEGASUS_PUBLISH_KEY'] ?? process.env['PEGASUS_VND_KEY'] ?? ''

function die(msg: string): never {
  console.error(`✖ ${msg}`)
  process.exit(1)
}

if (!apiBase)
  die('API_BASE_URL (or PEGASUS_API_BASE_URL) is required, e.g. https://api.pegasus-qa.dolas.dev')
if (!publishKey)
  die('PEGASUS_PUBLISH_KEY (or PEGASUS_VND_KEY) is required — the platform-tenant vnd_ key')
if (only && !BUILTINS.some((b) => b.id === only))
  die(`unknown integration "${only}" (known: ${BUILTINS.map((b) => b.id).join(', ')})`)

const targets = only ? BUILTINS.filter((b) => b.id === only) : BUILTINS

// ── HTTP helper ───────────────────────────────────────────────────────────────
async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${publishKey}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
  }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await fetch(`${apiBase}/api/v1${path}`, init)
  const text = await res.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: res.status, json }
}

function sortedIds(arr: string[]): string[] {
  return [...arr].sort()
}

function reportSummary(report: GateReport): string {
  const c = report.corpus
  const probs = report.problems.length ? ` problems=${report.problems.length}` : ''
  return `ok=${report.ok} corpus=${c.passed}/${c.total}${probs}`
}

// ── Gate (dry-run validate) ───────────────────────────────────────────────────
async function gate(cfg: BuiltinConfig): Promise<GateReport> {
  const corpus = getGateCorpus(cfg.id) as GateCorpusCase[]
  const { status, json } = await api('POST', `/integrations/${cfg.id}/config/validate`, {
    mapping: cfg.mapping,
    rules: cfg.rules,
    corpus,
  })
  if (status !== 200) {
    console.error(`  response: ${JSON.stringify(json)}`)
    die(`[${cfg.id}] /config/validate returned ${status}`)
  }
  return (json as { data: GateReport }).data
}

// ── Publish ───────────────────────────────────────────────────────────────────
async function publish(cfg: BuiltinConfig): Promise<void> {
  const corpus = getGateCorpus(cfg.id) as GateCorpusCase[]
  const { status, json } = await api('POST', `/integrations/${cfg.id}/config`, {
    mapping: cfg.mapping,
    rules: cfg.rules,
    corpus,
  })
  if (status !== 201) {
    console.error(`  response: ${JSON.stringify(json)}`)
    die(`[${cfg.id}] publish returned ${status} (expected 201)`)
  }
  const row = (json as { data: { version: number; visibility: string } }).data
  console.log(`  ✔ published ${cfg.id} v${row.version} (${row.visibility})`)
}

// ── Verify: overlay live + behavior unchanged ────────────────────────────────
interface VerifyDiff {
  case: string
  expected: { valid: boolean; ruleIds: string[] }
  actual: { valid: boolean; ruleIds: string[]; degraded: boolean }
}

async function verify(cfg: BuiltinConfig): Promise<VerifyDiff[]> {
  // Confirm the rows are served for this scope.
  const active = await api('GET', `/integrations/${cfg.id}/config`)
  if (active.status !== 200) {
    console.error(`  response: ${JSON.stringify(active.json)}`)
    die(`[${cfg.id}] GET /config returned ${active.status} (no published config to verify?)`)
  }
  const activeRow = (active.json as { data: { version: number; visibility: string } }).data
  const versions = await api('GET', `/integrations/${cfg.id}/config/versions`)
  const count = (versions.json as { meta?: { count?: number } }).meta?.count ?? '?'
  console.log(`  active v${activeRow.version} (${activeRow.visibility}); ${count} version(s)`)

  // Replay EVERY corpus case (incl. structural-rejection fixtures) through the
  // live validate endpoint. The published mapping/rules equal the built-in floor,
  // so the expected diff is NONE — that is the safety proof.
  const corpus = getBuiltinCorpus(cfg.id) as GateCorpusCase[]
  const diffs: VerifyDiff[] = []
  for (const tc of corpus) {
    const { status, json } = await api('POST', `/integrations/${cfg.id}/validate`, tc.input)
    if (status !== 200) {
      console.error(`  response: ${JSON.stringify(json)}`)
      die(`[${cfg.id}] /validate returned ${status} for case "${tc.name}"`)
    }
    const result = json as {
      valid: boolean
      degraded: boolean
      issues: { ruleId: string }[]
    }
    const actualIds = sortedIds(result.issues.map((i) => i.ruleId))
    const expectedIds = sortedIds(tc.expected.ruleIds)
    const same =
      !result.degraded &&
      result.valid === tc.expected.valid &&
      actualIds.length === expectedIds.length &&
      actualIds.every((id, i) => id === expectedIds[i])
    if (!same) {
      diffs.push({
        case: tc.name,
        expected: { valid: tc.expected.valid, ruleIds: expectedIds },
        actual: { valid: result.valid, ruleIds: actualIds, degraded: result.degraded },
      })
    }
  }
  return diffs
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const mode = doPublish
    ? doVerify
      ? 'publish+verify'
      : 'publish'
    : doVerify
      ? 'verify'
      : 'dry-run'
  console.log(`=== integration-config dogfood — ${mode} ===`)
  console.log(`api: ${apiBase}   targets: ${targets.map((t) => t.id).join(', ')}\n`)

  let failures = 0

  for (const cfg of targets) {
    console.log(`▶ ${cfg.id}`)

    // Always gate first (pre-check). A failing gate stops this integration.
    const report = await gate(cfg)
    console.log(`  gate: ${reportSummary(report)}`)
    if (!report.ok) {
      console.error(`  ✖ gate failed — not publishing ${cfg.id}`)
      console.error(`  ${JSON.stringify(report.problems)}`)
      console.error(`  ${JSON.stringify(report.corpus.failures)}`)
      failures++
      continue
    }

    if (doPublish) await publish(cfg)

    if (doVerify) {
      const diffs = await verify(cfg)
      if (diffs.length === 0) {
        console.log(`  ✔ verify: zero validation diffs`)
      } else {
        console.error(`  ✖ verify: ${diffs.length} diff(s) — behavior changed!`)
        for (const d of diffs) console.error(`    ${JSON.stringify(d)}`)
        failures++
      }
    }

    console.log('')
  }

  if (failures > 0) die(`${failures} integration(s) failed`)
  console.log('✔ all good')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
