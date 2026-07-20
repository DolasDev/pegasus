import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { analyzeMapping } from './mapping-static-check'
import { DemoPartnerOrderSchema } from '../canonical-demo-partner'
import { demoPartnerInputFieldRoots } from './demo-partner.transform'
import { listIntegrationIds, getIntegrationDefinition } from '../registry'

const demoPartnerJsonSchema = z.toJSONSchema(DemoPartnerOrderSchema)

describe('analyzeMapping', () => {
  it('flags a mapping to a field the canonical contract does not have', () => {
    const problems = analyzeMapping(
      { bogusField: 'x' },
      { canonicalJsonSchema: demoPartnerJsonSchema },
    )
    expect(problems).toContainEqual({
      where: 'bogusField',
      problem: 'maps to unknown canonical field "bogusField"',
    })
  })

  it('flags a $each element mapping to an unknown canonical sub-field', () => {
    const problems = analyzeMapping(
      { shipments: { $from: 'shipments', $each: { ghost: 'order_num' } } },
      { canonicalJsonSchema: demoPartnerJsonSchema },
    )
    expect(problems).toContainEqual({
      where: 'shipments[].ghost',
      problem: 'maps to unknown canonical field "shipments[].ghost"',
    })
  })

  it('flags a $from that reads an undeclared input field root', () => {
    const problems = analyzeMapping(
      { serviceStatus: { $from: 'totally_made_up' } },
      { canonicalJsonSchema: demoPartnerJsonSchema, inputFieldRoots: demoPartnerInputFieldRoots },
    )
    expect(problems).toContainEqual({
      where: 'totally_made_up',
      problem: 'reads undeclared input field "totally_made_up"',
    })
  })

  // sdk-feedback 0028 — a floor can open a specific vetted sub-path of an
  // otherwise-closed root (Pegii's UnusedFields junk-drawer).
  describe('curated input sub-paths (0028)', () => {
    it('accepts a mapping reading a declared UnusedFields sub-path directly', () => {
      const problems = analyzeMapping(
        { surveyDate: { $from: 'UnusedFields.survey_received', default: null } },
        { canonicalJsonSchema: demoPartnerJsonSchema, inputFieldRoots: demoPartnerInputFieldRoots },
      )
      expect(problems).toEqual([])
    })

    it('accepts the sibling survey_confirm sub-path too', () => {
      const problems = analyzeMapping(
        { surveyDate: { $from: 'UnusedFields.survey_confirm', default: null } },
        { canonicalJsonSchema: demoPartnerJsonSchema, inputFieldRoots: demoPartnerInputFieldRoots },
      )
      expect(problems).toEqual([])
    })

    it('still rejects an un-whitelisted UnusedFields.* sibling (guardrail intact)', () => {
      const problems = analyzeMapping(
        { surveyDate: { $from: 'UnusedFields.truck_name', default: null } },
        { canonicalJsonSchema: demoPartnerJsonSchema, inputFieldRoots: demoPartnerInputFieldRoots },
      )
      expect(problems).toContainEqual({
        where: 'UnusedFields',
        problem: 'reads undeclared input field "UnusedFields"',
      })
    })

    it('still rejects a bare read of the otherwise-closed UnusedFields root', () => {
      const problems = analyzeMapping(
        { surveyDate: { $from: 'UnusedFields', default: null } },
        { canonicalJsonSchema: demoPartnerJsonSchema, inputFieldRoots: demoPartnerInputFieldRoots },
      )
      expect(problems).toContainEqual({
        where: 'UnusedFields',
        problem: 'reads undeclared input field "UnusedFields"',
      })
    })

    it('reports a closed root once even when several of its sub-paths are read', () => {
      const problems = analyzeMapping(
        {
          surveyDate: { $from: 'UnusedFields.truck_name', default: null },
          contactMadeDate: { $from: 'UnusedFields.load_labor_date', default: null },
        },
        { canonicalJsonSchema: demoPartnerJsonSchema, inputFieldRoots: demoPartnerInputFieldRoots },
      )
      expect(problems.filter((p) => p.where === 'UnusedFields')).toHaveLength(1)
    })
  })

  it('flags an ill-formed mapping document', () => {
    const problems = analyzeMapping(
      { a: { $from: '' } },
      { canonicalJsonSchema: demoPartnerJsonSchema },
    )
    expect(problems[0]?.problem).toMatch(/invalid mapping format/)
  })

  it('accepts a $map whose outputs are all members of the target field enum', () => {
    const problems = analyzeMapping(
      { serviceStatus: { $from: 'Survey.SerivceStatus', $map: { active: 'Accepted' } } },
      { canonicalJsonSchema: demoPartnerJsonSchema },
    )
    expect(problems).toEqual([])
  })

  it('flags a $map output that is not a valid value for an enum target field', () => {
    const problems = analyzeMapping(
      { serviceStatus: { $from: 'Survey.SerivceStatus', $map: { active: 'Bogus' } } },
      { canonicalJsonSchema: demoPartnerJsonSchema },
    )
    expect(problems).toContainEqual({
      where: 'serviceStatus',
      problem: expect.stringMatching(/\$map output "Bogus" is not a valid "serviceStatus" value/),
    })
  })

  it('flags $map combined with $each (value translation is scalar-only)', () => {
    const problems = analyzeMapping(
      { shipments: { $from: 'shipments', $map: { a: 'b' }, $each: { supplierShipmentId: 'Id' } } },
      { canonicalJsonSchema: demoPartnerJsonSchema },
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
