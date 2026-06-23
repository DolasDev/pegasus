import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runGatePipeline, type GateCorpusCase } from '../gate-pipeline'
import { getIntegrationDefinition } from '../registry'
import {
  BUILTIN_CORPORA,
  getBuiltinCorpus,
  getGateCorpus,
  longhaulCorpus,
  weichertCorpus,
} from './index'

// vitest runs with cwd = the apps/api package root.
function readCorpusFromDisk(integrationId: string): GateCorpusCase[] {
  const dir = join(process.cwd(), 'src/integration-validation/__corpus__', integrationId)
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as GateCorpusCase)
}

describe('built-in corpus exports', () => {
  it.each(Object.keys(BUILTIN_CORPORA))(
    'the %s export equals the on-disk __corpus__ files (filename order)',
    (integrationId) => {
      const onDisk = readCorpusFromDisk(integrationId)
      // Deep-equal, in filename order — a new fixture not added to the index, a
      // stale entry, or any content drift fails here. This is what lets the
      // publish script trust the import instead of fs-reading the directory.
      expect(getBuiltinCorpus(integrationId)).toEqual(onDisk)
    },
  )

  it('exposes a non-empty corpus for both shipped integrations', () => {
    expect(longhaulCorpus.length).toBeGreaterThan(0)
    expect(weichertCorpus.length).toBeGreaterThan(0)
  })

  // The DoD: runGatePipeline(base, { mapping, rules, corpus }) is ok for both
  // built-ins using the EXPORTS (not an fs read). The publish body uses the
  // gate-eligible subset (structural-rejection fixtures are validate-only).
  it.each(Object.keys(BUILTIN_CORPORA))(
    'the %s built-in mapping + rules pass the gate against the exported gate corpus',
    (integrationId) => {
      const base = getIntegrationDefinition(integrationId)!
      const report = runGatePipeline(base, {
        mapping: base.mapping,
        rules: base.rules,
        corpus: getGateCorpus(integrationId)!,
      })
      expect(report.problems).toEqual([])
      expect(report.corpus.failures).toEqual([])
      expect(report.ok).toBe(true)
    },
  )

  it('drops structural-rejection fixtures from the gate corpus but keeps them in the full corpus', () => {
    // longhaul ships 12-structural-bad-status (expects structural-contract); it
    // must survive in the full corpus and be absent from the gate corpus.
    const full = getBuiltinCorpus('longhaul')!
    const gate = getGateCorpus('longhaul')!
    expect(full.some((c) => c.expected.ruleIds.includes('structural-contract'))).toBe(true)
    expect(gate.some((c) => c.expected.ruleIds.includes('structural-contract'))).toBe(false)
    expect(gate.length).toBe(full.length - 1)
  })
})
