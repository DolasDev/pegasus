import { describe, it, expect } from 'vitest'
import { runGatePipeline } from './gate-pipeline'
import { getIntegrationDefinition } from './registry'
import { demoPartnerCorpus } from './corpus'

const base = getIntegrationDefinition('demo_partner')!

// The typed corpus export (corpus.test.ts asserts it equals the on-disk files).
const corpus = demoPartnerCorpus

describe('runGatePipeline', () => {
  it('passes for the shipped demo_partner mapping + rules against its own corpus', () => {
    const report = runGatePipeline(base, { mapping: base.mapping, rules: base.rules, corpus })
    expect(report.problems).toEqual([])
    expect(report.corpus.failures).toEqual([])
    expect(report.corpus.passed).toBe(corpus.length)
    expect(report.ok).toBe(true)
  })

  it('flags a mapping to an unknown canonical field', () => {
    const report = runGatePipeline(base, {
      mapping: { ...base.mapping, bogusField: 'x' },
      rules: base.rules,
      corpus,
    })
    expect(report.ok).toBe(false)
    expect(
      report.problems.some(
        (p) => p.stage === 'mapping' && /unknown canonical field/.test(p.problem),
      ),
    ).toBe(true)
  })

  it('flags a rule referencing an unknown fact', () => {
    const rules = [
      ...base.rules,
      {
        id: 'bad-fact',
        description: 'd',
        field: 'serviceStatus',
        message: 'm',
        when: [{ fact: 'ghostFact', op: 'eq', value: true }],
      },
    ]
    const report = runGatePipeline(base, { mapping: base.mapping, rules, corpus })
    expect(report.ok).toBe(false)
    expect(report.problems.some((p) => p.stage === 'rules' && /unknown fact/.test(p.problem))).toBe(
      true,
    )
  })

  it('flags a rule whose field is not a canonical field', () => {
    const rules = [
      ...base.rules,
      {
        id: 'bad-field',
        description: 'd',
        field: 'made_up_field',
        message: 'm',
        when: [{ fact: 'serviceStatus', op: 'eq', value: 'Submitted' }],
      },
    ]
    const report = runGatePipeline(base, { mapping: base.mapping, rules, corpus })
    expect(
      report.problems.some((p) => p.stage === 'rules' && /not a canonical field/.test(p.problem)),
    ).toBe(true)
  })

  it('flags a $map output outside the target field enum', () => {
    const report = runGatePipeline(base, {
      mapping: {
        ...base.mapping,
        serviceStatus: { $from: 'Survey.SerivceStatus', $map: { x: 'NotAStatus' } },
      },
      rules: base.rules,
      corpus,
    })
    expect(
      report.problems.some((p) => p.stage === 'mapping' && /\$map output/.test(p.problem)),
    ).toBe(true)
  })

  it('reports a behavioral corpus regression when a covered rule is removed', () => {
    const rules = base.rules.filter((r) => r.id !== 'service-status-not-supplier-settable')
    const report = runGatePipeline(base, { mapping: base.mapping, rules, corpus })
    expect(report.ok).toBe(false)
    expect(report.corpus.failures.some((f) => f.reason === 'behavioral')).toBe(true)
  })

  // sdk-feedback 0039 + 0040 together: this is the exact shape of config a partner
  // needs (`estimated` from KeyMoveDates.*.Planned, every date reformatted to
  // YYYY-MM-DD, the .NET sentinel nulled) and the exact command an author runs
  // against it — `integration-config validate`, which is this pipeline.
  it('passes a candidate mapping the estimated halves with date coercions', () => {
    const shipments = base.mapping['shipments'] as {
      $from: string
      $each: Record<string, unknown>
    }
    const dateOnly = (path: string): unknown => ({
      $from: path,
      // The sentinel half is `$map`'s job; the format half is `coerce`'s. Both in
      // one leaf, which is only possible because coerce runs after $map.
      $map: { '0001-01-01T00:00:00': null },
      coerce: 'toDateOnly',
    })
    const report = runGatePipeline(base, {
      mapping: {
        ...base.mapping,
        contactMadeDate: dateOnly('DocumentationDates[0]'),
        surveyDate: dateOnly('KeyMoveDates.Survey.Planned'),
        shipments: {
          ...shipments,
          $each: {
            ...shipments.$each,
            surveyDate: {
              estimated: dateOnly('KeyMoveDates.Survey.Planned'),
              actual: dateOnly('KeyMoveDates.Survey.Actual'),
            },
            packDate1: {
              estimated: dateOnly('KeyMoveDates.Pack.Planned'),
              actual: dateOnly('KeyMoveDates.Pack.Actual'),
            },
            loadDate1: {
              estimated: dateOnly('KeyMoveDates.Load.Planned'),
              actual: dateOnly('KeyMoveDates.Load.Actual'),
            },
            deliveryDate1: {
              estimated: dateOnly('KeyMoveDates.Delivery.Planned'),
              actual: dateOnly('KeyMoveDates.Delivery.Actual'),
            },
          },
        },
      },
      rules: base.rules,
      corpus,
    })
    expect(report.problems).toEqual([])
    // Every corpus verdict is unchanged: the new fields are fact-neutral and the
    // coercion is a no-op on the already-date-only fixtures.
    expect(report.corpus.failures).toEqual([])
    expect(report.corpus.passed).toBe(corpus.length)
    expect(report.ok).toBe(true)
  })

  it('stops before the corpus when the mapping is malformed', () => {
    const report = runGatePipeline(base, {
      mapping: { a: { $from: '' } },
      rules: base.rules,
      corpus,
    })
    expect(report.problems.some((p) => p.stage === 'mapping-format')).toBe(true)
    expect(report.corpus.passed).toBe(0)
  })
})
