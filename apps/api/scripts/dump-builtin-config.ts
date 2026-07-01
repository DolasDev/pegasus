#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Dump a built-in integration's editable surface (mapping + rules + the
// gate-eligible corpus) to the three JSON files the SDK authoring flow reads:
// mapping.json / rules.json / corpus.json.
//
// This seeds an author's working directory from the BUILT-IN floor — the
// complement to `pegasus-workflows integration-config pull`, which can only
// fetch an already-PUBLISHED config. Before anything is published, this is how
// you materialise the starting point (and it's exactly the identical-to-floor
// payload the dogfood publishes).
//
// Usage (single-line):
//   npx tsx scripts/dump-builtin-config.ts <integrationId> <outDir>
//   npx tsx scripts/dump-builtin-config.ts demo_partner ../../../pegasus-workflows/platform/integrations/demo_partner
//
// The canonical published integration configs now live in the pegasus-workflows
// repo (platform/integrations/<id>/); this script regenerates that JSON snapshot
// from the built-in floor whenever the floor changes.
//
// The corpus is the GATE-ELIGIBLE subset (structural-rejection fixtures dropped),
// so the dumped files are publish-ready as-is.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { demoPartnerMapping } from '../src/integration-validation/transform/demo-partner.transform'
import { demoPartnerRules } from '../src/integration-validation/rules/demo-partner.rules'
import { getGateCorpus } from '../src/integration-validation/corpus'

const BUILTINS: Record<string, { mapping: unknown; rules: unknown }> = {
  demo_partner: { mapping: demoPartnerMapping, rules: demoPartnerRules },
}

const [integrationId, outDirArg] = process.argv.slice(2)

if (!integrationId || !outDirArg) {
  console.error('usage: tsx scripts/dump-builtin-config.ts <integrationId> <outDir>')
  process.exit(1)
}
const builtin = BUILTINS[integrationId]
if (!builtin) {
  console.error(
    `unknown integration "${integrationId}" (known: ${Object.keys(BUILTINS).join(', ')})`,
  )
  process.exit(1)
}

const outDir = resolve(outDirArg)
mkdirSync(outDir, { recursive: true })

const files: Record<string, unknown> = {
  'mapping.json': builtin.mapping,
  'rules.json': builtin.rules,
  'corpus.json': getGateCorpus(integrationId),
}

for (const [name, value] of Object.entries(files)) {
  writeFileSync(join(outDir, name), JSON.stringify(value, null, 2) + '\n')
  console.log(`wrote ${join(outDir, name)}`)
}
console.log(`\ndumped ${integrationId} built-in config -> ${outDir}`)
