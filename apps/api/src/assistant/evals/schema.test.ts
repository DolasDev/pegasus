import { describe, expect, it } from 'vitest'

import opsBaseline from './ops-baseline.json'
import { parseEvalSet } from './schema'

// The eval set is authored by the operations administrator by hand, so the
// only thing standing between a typo and a silently-miscounted pass rate is
// this test. It runs with no DB and no network.
describe('assistant eval set', () => {
  it('parses the checked-in ops baseline', () => {
    const set = parseEvalSet(opsBaseline)

    expect(set.version).toBe(1)
    expect(set.cases.length).toBeGreaterThan(0)
  })

  it('defaults the two substring lists so a terse case still grades', () => {
    const set = parseEvalSet({
      version: 1,
      cases: [
        {
          id: 'terse',
          question: 'how many moves are open?',
          askedAs: 'operations_admin',
          outcome: 'answer',
          expected: { answer: 'Eleven.' },
          source: { screen: 'Moves list', endpoint: '/api/v1/runtime/moves' },
        },
      ],
    })

    expect(set.cases[0]?.expected.mustInclude).toEqual([])
    expect(set.cases[0]?.expected.mustNotInclude).toEqual([])
  })

  it('accepts a null endpoint — the planning surface is screen-sourced', () => {
    const set = parseEvalSet({
      version: 1,
      cases: [
        {
          id: 'screen-only',
          question: 'which trips are late?',
          askedAs: 'operations_admin',
          outcome: 'answer',
          expected: { answer: 'Trip 4471.' },
          source: { screen: 'Operations → Planning → Trips', endpoint: null },
        },
      ],
    })

    expect(set.cases[0]?.source.endpoint).toBeNull()
  })

  it('rejects a service-account persona — the assistant runs as a human', () => {
    expect(() =>
      parseEvalSet({
        version: 1,
        cases: [
          {
            id: 'wrong-persona',
            question: 'anything',
            askedAs: 'reporting',
            outcome: 'answer',
            expected: { answer: 'x' },
            source: { screen: 'Moves list', endpoint: null },
          },
        ],
      }),
    ).toThrow()
  })

  it('rejects a non-kebab id', () => {
    expect(() =>
      parseEvalSet({
        version: 1,
        cases: [
          {
            id: 'Not Kebab',
            question: 'anything',
            askedAs: 'driver',
            outcome: 'answer',
            expected: { answer: 'x' },
            source: { screen: 'My trips', endpoint: null },
          },
        ],
      }),
    ).toThrow(/kebab-case/)
  })

  it('rejects duplicate ids — they key the pass-rate trend', () => {
    const duplicated = {
      id: 'same-id',
      question: 'anything',
      askedAs: 'driver',
      outcome: 'answer',
      expected: { answer: 'x' },
      source: { screen: 'My trips', endpoint: null },
    }

    expect(() => parseEvalSet({ version: 1, cases: [duplicated, duplicated] })).toThrow(
      /duplicate case id/,
    )
  })

  it('rejects a refuse case that forbids nothing', () => {
    expect(() =>
      parseEvalSet({
        version: 1,
        cases: [
          {
            id: 'toothless-refusal',
            question: 'what did we bill for this move?',
            askedAs: 'driver',
            outcome: 'refuse',
            expected: { answer: 'Should decline.' },
            source: { screen: 'Not visible to a driver', endpoint: null },
          },
        ],
      }),
    ).toThrow(/may never contain/)
  })
})
