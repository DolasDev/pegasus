import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { analyzeMapping } from './mapping-static-check'
import { WeichertOrderSchema } from '../canonical-weichert'
import { weichertInputFieldRoots } from './weichert.transform'
import { listIntegrationIds, getIntegrationDefinition } from '../registry'

const weichertJsonSchema = z.toJSONSchema(WeichertOrderSchema)

describe('analyzeMapping', () => {
  it('flags a mapping to a field the canonical contract does not have', () => {
    const problems = analyzeMapping(
      { bogusField: 'x' },
      { canonicalJsonSchema: weichertJsonSchema },
    )
    expect(problems).toContainEqual({
      where: 'bogusField',
      problem: 'maps to unknown canonical field "bogusField"',
    })
  })

  it('flags a $each element mapping to an unknown canonical sub-field', () => {
    const problems = analyzeMapping(
      { shipments: { $from: 'shipments', $each: { ghost: 'order_num' } } },
      { canonicalJsonSchema: weichertJsonSchema },
    )
    expect(problems).toContainEqual({
      where: 'shipments[].ghost',
      problem: 'maps to unknown canonical field "shipments[].ghost"',
    })
  })

  it('flags a $from that reads an undeclared input field root', () => {
    const problems = analyzeMapping(
      { serviceStatus: { $from: 'totally_made_up' } },
      { canonicalJsonSchema: weichertJsonSchema, inputFieldRoots: weichertInputFieldRoots },
    )
    expect(problems).toContainEqual({
      where: 'totally_made_up',
      problem: 'reads undeclared input field "totally_made_up"',
    })
  })

  it('flags an ill-formed mapping document', () => {
    const problems = analyzeMapping(
      { a: { $from: '' } },
      { canonicalJsonSchema: weichertJsonSchema },
    )
    expect(problems[0]?.problem).toMatch(/invalid mapping format/)
  })

  it('accepts a $map whose outputs are all members of the target field enum', () => {
    const problems = analyzeMapping(
      { serviceStatus: { $from: 'Survey.SerivceStatus', $map: { active: 'Accepted' } } },
      { canonicalJsonSchema: weichertJsonSchema },
    )
    expect(problems).toEqual([])
  })

  it('flags a $map output that is not a valid value for an enum target field', () => {
    const problems = analyzeMapping(
      { serviceStatus: { $from: 'Survey.SerivceStatus', $map: { active: 'Bogus' } } },
      { canonicalJsonSchema: weichertJsonSchema },
    )
    expect(problems).toContainEqual({
      where: 'serviceStatus',
      problem: expect.stringMatching(/\$map output "Bogus" is not a valid "serviceStatus" value/),
    })
  })

  it('flags $map combined with $each (value translation is scalar-only)', () => {
    const problems = analyzeMapping(
      { shipments: { $from: 'shipments', $map: { a: 'b' }, $each: { supplierShipmentId: 'Id' } } },
      { canonicalJsonSchema: weichertJsonSchema },
    )
    expect(problems).toContainEqual({
      where: 'shipments',
      problem: expect.stringMatching(/scalar-only/),
    })
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
