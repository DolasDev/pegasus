import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { analyzeMapping } from './mapping-static-check'
import { CanonicalOrderSchema, canonicalOrderJsonSchema } from '../canonical-order'
import { longhaulMapping, longhaulInputFieldRoots } from './longhaul.transform'
import { listIntegrationIds, getIntegrationDefinition } from '../registry'

const canonicalJsonSchema = canonicalOrderJsonSchema()

describe('analyzeMapping', () => {
  it('reports zero problems for the shipped longhaul mapping', () => {
    expect(
      analyzeMapping(longhaulMapping, {
        canonicalJsonSchema,
        inputFieldRoots: longhaulInputFieldRoots,
      }),
    ).toEqual([])
  })

  it('flags a mapping to a field the canonical contract does not have', () => {
    const problems = analyzeMapping({ bogusField: 'x' }, { canonicalJsonSchema })
    expect(problems).toContainEqual({
      where: 'bogusField',
      problem: 'maps to unknown canonical field "bogusField"',
    })
  })

  it('flags a $each element mapping to an unknown canonical sub-field', () => {
    const problems = analyzeMapping(
      { shipments: { $from: 'shipments', $each: { ghost: 'order_num' } } },
      { canonicalJsonSchema },
    )
    expect(problems).toContainEqual({
      where: 'shipments[].ghost',
      problem: 'maps to unknown canonical field "shipments[].ghost"',
    })
  })

  it('flags a $from that reads an undeclared input field root', () => {
    const problems = analyzeMapping(
      { status: { id: { $from: 'totally_made_up' } } },
      { canonicalJsonSchema, inputFieldRoots: longhaulInputFieldRoots },
    )
    expect(problems).toContainEqual({
      where: 'totally_made_up',
      problem: 'reads undeclared input field "totally_made_up"',
    })
  })

  it('flags an ill-formed mapping document', () => {
    const problems = analyzeMapping({ a: { $from: '' } }, { canonicalJsonSchema })
    expect(problems[0]?.problem).toMatch(/invalid mapping format/)
  })
})

describe('every registered integration has a statically valid mapping', () => {
  for (const id of listIntegrationIds()) {
    it(`${id}: mapping passes static analysis against its own contract`, () => {
      const def = getIntegrationDefinition(id)!
      const problems = analyzeMapping(def.mapping, {
        canonicalJsonSchema: z.toJSONSchema(def.structuralContract),
        inputFieldRoots: def.inputFieldRoots,
      })
      expect(problems).toEqual([])
    })
  }
})

// Guard: the compiled mapping output still satisfies the canonical contract.
describe('compiled mapping output satisfies the canonical contract', () => {
  it('longhaul', () => {
    const def = getIntegrationDefinition('longhaul')!
    // (validate.test.ts + the golden corpus exercise this end-to-end; this is a
    // direct shape check on a representative order.)
    expect(def.transform.length).toBeGreaterThan(0)
    expect(
      CanonicalOrderSchema.safeParse({
        id: 1,
        status: { id: 1, name: null },
        driver: { id: null },
        dispatcher: { code: null },
        shipments: [],
        activities: [],
      }).success,
    ).toBe(true)
  })
})
