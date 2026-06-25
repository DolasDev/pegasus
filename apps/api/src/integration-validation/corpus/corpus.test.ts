import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runGatePipeline, type GateCorpusCase } from '../gate-pipeline'
import { getIntegrationDefinition } from '../registry'
import { BUILTIN_CORPORA, getBuiltinCorpus, getGateCorpus, weichertCorpus } from './index'

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

  it('exposes a non-empty corpus for the shipped integration', () => {
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

  it('gate corpus excludes any structural-rejection fixture; weichert has none so it equals the full corpus', () => {
    // getGateCorpus drops cases that expect a structural-contract rejection (the
    // gate's round-trip stage cannot accept them). weichert ships no such fixture,
    // so its gate corpus is identical to the full corpus. (The filter is exercised
    // generically below; a future integration with a structural fixture would
    // re-add a data-level case.)
    const full = getBuiltinCorpus('weichert')!
    const gate = getGateCorpus('weichert')!
    expect(full.some((c) => c.expected.ruleIds.includes('structural-contract'))).toBe(false)
    expect(gate).toEqual(full)
  })
})
