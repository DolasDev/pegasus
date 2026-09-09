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
    expect(problems).toHaveLength(1)
    // Reported at the TARGET, like the canonical-target check, and naming what
    // the floor does allow so the author can fix it without reading source.
    expect(problems[0]!.where).toBe('serviceStatus')
    expect(problems[0]!.problem).toContain('reads undeclared input field "totally_made_up"')
    expect(problems[0]!.problem).toContain('allowed: InvolvedParties, Survey')
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
      expect(problems).toHaveLength(1)
      expect(problems[0]!.where).toBe('surveyDate')
      expect(problems[0]!.problem).toContain(
        'reads undeclared input field "UnusedFields.truck_name"',
      )
    })

    it('still rejects a bare read of the otherwise-closed UnusedFields root', () => {
      const problems = analyzeMapping(
        { surveyDate: { $from: 'UnusedFields', default: null } },
        { canonicalJsonSchema: demoPartnerJsonSchema, inputFieldRoots: demoPartnerInputFieldRoots },
      )
      expect(problems).toHaveLength(1)
      expect(problems[0]!.where).toBe('surveyDate')
      expect(problems[0]!.problem).toContain('reads undeclared input field "UnusedFields"')
    })

    it('reports EVERY offending read, at its own target', () => {
      const problems = analyzeMapping(
        {
          surveyDate: { $from: 'UnusedFields.truck_name', default: null },
          contactMadeDate: { $from: 'UnusedFields.load_labor_date', default: null },
        },
        { canonicalJsonSchema: demoPartnerJsonSchema, inputFieldRoots: demoPartnerInputFieldRoots },
      )
      // Was once de-duped to one problem per closed ROOT, which hid every read
      // after the first; a per-read report is what an author needs to fix them.
      expect(problems.map((p) => p.where).sort()).toEqual(['contactMadeDate', 'surveyDate'])
    })
  })

  // sdk-feedback 0042 — the source side of a mapping was checked only at order
  // scope, so every `$from` inside `$each` (the great majority of a real mapping,
  // which builds `shipments` from `$from: "."`) went uninspected and published green.
  describe('input roots are enforced inside $each (0042)', () => {
    const each = (leaf: Record<string, unknown>): Record<string, unknown> => ({
      shipments: { $from: '.', $each: leaf },
    })
    const opts = {
      canonicalJsonSchema: demoPartnerJsonSchema,
      inputFieldRoots: demoPartnerInputFieldRoots,
    }

    it('rejects an undeclared root read inside $each over "."', () => {
      const problems = analyzeMapping(
        each({ surveyedThirdPartyCosts: { $from: 'ZZZ_NoSuchRoot.Nope' } }),
        opts,
      )
      expect(problems).toHaveLength(1)
      expect(problems[0]!.where).toBe('shipments[].surveyedThirdPartyCosts')
      expect(problems[0]!.problem).toContain('reads undeclared input field "ZZZ_NoSuchRoot.Nope"')
    })

    it('rejects an un-whitelisted sub-path of a dotted root inside $each', () => {
      const problems = analyzeMapping(
        each({ comments: { $from: 'UnusedFields.truck_name' } }),
        opts,
      )
      expect(problems).toHaveLength(1)
      expect(problems[0]!.where).toBe('shipments[].comments')
    })

    it('accepts declared element-scope roots — the reads a real overlay makes', () => {
      const problems = analyzeMapping(
        each({
          supplierShipmentId: 'Id',
          shipmentStatus: { $from: 'Survey.ShipmentStatus' },
          netWeight: { estimated: 'Financials.EstimatedWeight', actual: 'Financials.ActualWeight' },
          packDate1: { estimated: 'KeyMoveDates.Pack.Planned', actual: 'KeyMoveDates.Pack.Actual' },
          comments: { $from: 'UnusedFields.survey_confirm' },
        }),
        opts,
      )
      expect(problems).toEqual([])
    })

    it('names the composed order-scope path when $each is over a real array', () => {
      const problems = analyzeMapping(
        { shipments: { $from: 'Survey', $each: { comments: { $from: 'Nope' } } } },
        opts,
      )
      // `Survey` is declared, so `Survey.Nope` is legal — the composition is what
      // makes it legal, and a read outside it is not.
      expect(problems).toEqual([])
      const bad = analyzeMapping(
        { shipments: { $from: 'UnusedFields.survey_confirm', $each: { comments: 'Elsewhere' } } },
        opts,
      )
      expect(bad).toHaveLength(0) // descendant of a declared sub-path is open
      const worse = analyzeMapping(
        { shipments: { $from: 'UnusedFields', $each: { comments: 'x' } } },
        opts,
      )
      expect(worse.map((p) => p.where)).toEqual(['shipments', 'shipments[].comments'])
      expect(worse[1]!.problem).toContain('resolves to "UnusedFields.x"')
    })
  })

  // sdk-feedback 0040 — the floor modeled milestone dates as `{ actual }` only, so
  // a config could not map the estimated half the partner documents and the source
  // supplies (`KeyMoveDates.<milestone>.Planned`).
  describe('milestone estimated + per-shipment survey dates (0040)', () => {
    const mapping = {
      shipments: {
        $from: '.',
        $each: {
          surveyDate: {
            estimated: { $from: 'KeyMoveDates.Survey.Planned', coerce: 'toDateOnly' },
            actual: {
              $from: 'KeyMoveDates.Survey.Actual',
              $map: { '0001-01-01T00:00:00': null },
              coerce: 'toDateOnly',
            },
          },
          packDate1: { estimated: { $from: 'KeyMoveDates.Pack.Planned', coerce: 'toDateOnly' } },
          loadDate1: { estimated: { $from: 'KeyMoveDates.Load.Planned', coerce: 'toDateOnly' } },
          deliveryDate1: {
            estimated: { $from: 'KeyMoveDates.Delivery.Planned', coerce: 'toDateOnly' },
          },
        },
      },
    }

    it('accepts a mapping to the estimated halves and the per-shipment surveyDate', () => {
      const problems = analyzeMapping(mapping, {
        canonicalJsonSchema: demoPartnerJsonSchema,
        inputFieldRoots: demoPartnerInputFieldRoots,
      })
      expect(problems).toEqual([])
    })

    it('still rejects a Date2/Date3 slot (deliberately not declared yet)', () => {
      // pegII exposes one slot per milestone, so these stay out of the contract
      // until a second slot is real rather than being added speculatively.
      const problems = analyzeMapping(
        { shipments: { $from: '.', $each: { packDate2: { actual: 'KeyMoveDates.Pack.Actual' } } } },
        { canonicalJsonSchema: demoPartnerJsonSchema },
      )
      expect(problems).toContainEqual({
        where: 'shipments[].packDate2.actual',
        problem: 'maps to unknown canonical field "shipments[].packDate2.actual"',
      })
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
