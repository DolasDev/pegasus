// ---------------------------------------------------------------------------
// Floor(type) + overlay(partner) split — sdk-feedback 0019 + 0020.
//
// Covers: the demo_partner overlay resolves to the shipment_status_update floor
// with an IDENTITY external body (byte-identical to pre-0020); a SECOND partner
// (allied_status) on the SAME floor emits a DIFFERENT external body; a NEW
// partner authored as a config overlay alone (floor reference, no built-in)
// resolves and maps; displayName (0019) flows from the overlay; and the publish
// gate checks the overlay's external mapping/shape.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  getIntegrationDefinition,
  getBuiltInDefinition,
  getFloor,
  getGateBase,
  listFloorIds,
  listIntegrationIds,
  loadRegistryOverlayIfStale,
  refreshRegistryOverlay,
  resolveIntegrationDefinition,
} from './registry'
import { mapToExternal, mapFromExternal, UnknownIntegrationError } from './validate'
import { runGatePipeline } from './gate-pipeline'
import { demoPartnerMapping } from './transform/demo-partner.transform'
import type { PrismaClient as PC } from '@prisma/client'

// A known-valid demo_partner native order (mirrors the map-to-external tests).
const nativeOrder = {
  Id: 'SHIP-1',
  InvolvedParties: {
    ShipperEmployer: { Identity: { Description: 'O-60232' } },
    Coordinator: {
      Identity: { Description: 'Suzanne Polo' },
      EmailAddress: 'noreply@demopartner.example',
    },
  },
  Survey: { SerivceStatus: 'Accepted', Storage1stDay: 100, GeneralComments: 'ok' },
  DocumentationDates: ['2024-05-25'],
  KeyMoveDates: { Survey: { Planned: '2024-05-25' } },
  Financials: { EstimatedWeight: 5000, ActualWeight: null },
}

function fakeDb(rows: unknown[]): PrismaClient {
  return { integrationConfig: { findMany: async () => rows } } as unknown as PrismaClient
}
const emptyDb = fakeDb([])

afterEach(async () => {
  await refreshRegistryOverlay(emptyDb)
})

describe('floor resolution', () => {
  it('demo_partner resolves onto the shipment_status_update floor', () => {
    const def = getBuiltInDefinition('demo_partner')!
    expect(def.floor).toBe('shipment_status_update')
    expect(def.displayName).toBe('Demo Partner')
    // Identity external ⇒ no external transform / no external JSON schema.
    expect(def.externalTransform).toBeUndefined()
    expect(def.externalJsonSchema).toBeUndefined()
  })

  it('allied_status shares the same floor but carries its own external shape', () => {
    const def = getBuiltInDefinition('allied_status')!
    expect(def.floor).toBe('shipment_status_update')
    expect(def.externalTransform).toBeDefined()
    expect(def.externalJsonSchema).toMatchObject({ type: 'object' })
    // Same floor ground truth (facts) as demo_partner.
    expect(def.factCatalog).toEqual(getBuiltInDefinition('demo_partner')!.factCatalog)
  })

  it('getFloor exposes the shared type floor', () => {
    expect(getFloor('shipment_status_update')?.floor).toBe('shipment_status_update')
    expect(getFloor('nope')).toBeUndefined()
  })
})

describe('two partners, one floor, different external bodies (AC2/AC3)', () => {
  it('demo_partner external body IS the canonical (identity)', () => {
    const { external, valid } = mapToExternal('demo_partner', nativeOrder, 'save')
    expect(valid).toBe(true)
    expect(external).toMatchObject({ serviceOrderNumber: 'O-60232', serviceStatus: 'Accepted' })
    expect((external!['shipments'] as unknown[]).length).toBe(1)
  })

  it('allied_status projects the SAME facts into a DIFFERENT external body', () => {
    const { external, valid } = mapToExternal('allied_status', nativeOrder, 'save')
    expect(valid).toBe(true)
    // Flattened / renamed Allied shape — not the canonical shape.
    expect(external).toEqual({
      orderRef: 'O-60232',
      orderStatus: 'Accepted',
      contactEmail: 'noreply@demopartner.example',
      contactName: 'Suzanne Polo',
    })
    expect(external!['serviceOrderNumber']).toBeUndefined()
    expect(external!['shipments']).toBeUndefined()
  })
})

describe('new partner authored as an overlay alone (AC1)', () => {
  const newPartnerRow = {
    integrationId: 'acme_status',
    version: 1,
    visibility: 'GLOBAL',
    status: 'PUBLISHED',
    floor: 'shipment_status_update',
    displayName: 'ACME',
    mapping: { serviceOrderNumber: 'InvolvedParties.ShipperEmployer.Identity.Description' },
    rules: [],
    externalShape: {
      type: 'object',
      additionalProperties: false,
      properties: { ref: { type: 'string' } },
    },
    externalMapping: { ref: 'serviceOrderNumber' },
  }

  it('resolves a NEW integration id from a GLOBAL overlay with no built-in floor', async () => {
    // No built-in for this id …
    expect(getBuiltInDefinition('acme_status')).toBeUndefined()
    // … but a GLOBAL overlay referencing an existing floor makes it resolvable.
    await refreshRegistryOverlay(fakeDb([newPartnerRow]))
    const def = getIntegrationDefinition('acme_status')!
    expect(def.floor).toBe('shipment_status_update')
    expect(def.displayName).toBe('ACME') // 0019
    expect(def.externalTransform).toBeDefined()
  })

  it('map_to_external for the new partner returns its external body (not 404/undefined)', async () => {
    await refreshRegistryOverlay(fakeDb([newPartnerRow]))
    const def = await resolveIntegrationDefinition(emptyDb, 'acme_status', null)
    expect(def).toBeDefined()
    const { external } = mapToExternal('acme_status', nativeOrder)
    expect(external).toEqual({ ref: 'O-60232' })
  })

  it('skips a NEW-partner row that references an unknown floor', async () => {
    await refreshRegistryOverlay(
      fakeDb([{ ...newPartnerRow, integrationId: 'ghost_status', floor: 'no_such_floor' }]),
    )
    expect(getIntegrationDefinition('ghost_status')).toBeUndefined()
  })
})

describe('publish gate checks the overlay external mapping/shape (AC2)', () => {
  const base = getGateBase('demo_partner')!
  const okCorpus = [
    {
      name: 'clean',
      input: { order: nativeOrder, action: 'save' as const },
      expected: { valid: true, ruleIds: [] },
    },
  ]

  it('passes when external mapping targets exist in the external shape', () => {
    const report = runGatePipeline(base, {
      mapping: getBuiltInDefinition('demo_partner')!.mapping,
      rules: getBuiltInDefinition('demo_partner')!.rules,
      corpus: okCorpus,
      externalShape: {
        type: 'object',
        additionalProperties: false,
        properties: { ref: { type: 'string' } },
      },
      externalMapping: { ref: 'serviceOrderNumber' },
    })
    expect(report.ok).toBe(true)
  })

  it('fails when an external mapping target is not in the external shape', () => {
    const report = runGatePipeline(base, {
      mapping: getBuiltInDefinition('demo_partner')!.mapping,
      rules: getBuiltInDefinition('demo_partner')!.rules,
      corpus: okCorpus,
      externalShape: {
        type: 'object',
        additionalProperties: false,
        properties: { ref: { type: 'string' } },
      },
      externalMapping: { notInShape: 'serviceOrderNumber' },
    })
    expect(report.ok).toBe(false)
    expect(report.problems.some((p) => p.stage === 'external-mapping')).toBe(true)
  })

  it('fails when an externalMapping is given without an externalShape', () => {
    const report = runGatePipeline(base, {
      mapping: getBuiltInDefinition('demo_partner')!.mapping,
      rules: getBuiltInDefinition('demo_partner')!.rules,
      corpus: okCorpus,
      externalMapping: { ref: 'serviceOrderNumber' },
    })
    expect(report.ok).toBe(false)
    expect(report.problems.some((p) => p.stage === 'external-shape')).toBe(true)
  })

  it('reports external-mapping-format for a malformed externalMapping', () => {
    const report = runGatePipeline(base, {
      mapping: getBuiltInDefinition('demo_partner')!.mapping,
      rules: getBuiltInDefinition('demo_partner')!.rules,
      corpus: okCorpus,
      externalShape: { type: 'object', properties: { ref: { type: 'string' } } },
      externalMapping: { ref: { $from: '' } }, // empty $from ⇒ format error
    })
    expect(report.ok).toBe(false)
    expect(report.problems.some((p) => p.stage === 'external-mapping-format')).toBe(true)
  })
})

describe('curated UnusedFields survey read via map_from_external (0028)', () => {
  // A GLOBAL overlay on the shipment_status_update floor whose surveyDate is read
  // straight from Pegii's UnusedFields junk-drawer — no pre-map lift into
  // Survey.SurveyReceived. This is the shape the real demo_partner config adopts
  // once 0028 ships. (Full demo mapping, surveyDate repointed, so the canonical
  // structurally validates.)
  const surveyProbeRow = {
    integrationId: 'survey_probe',
    version: 1,
    visibility: 'GLOBAL',
    status: 'PUBLISHED',
    floor: 'shipment_status_update',
    displayName: 'Survey Probe',
    mapping: {
      ...demoPartnerMapping,
      surveyDate: { $from: 'UnusedFields.survey_received', default: null },
    },
    rules: [],
  }

  it('returns surveyDate straight from UnusedFields.survey_received — no pre-lift (AC#2)', async () => {
    await refreshRegistryOverlay(fakeDb([surveyProbeRow]))
    const order = { ...nativeOrder, UnusedFields: { survey_received: '2024-06-01' } }
    const { canonical, valid } = mapFromExternal('survey_probe', order)
    expect(valid).toBe(true)
    expect(canonical?.['surveyDate']).toBe('2024-06-01')
  })

  it('maps an empty/sentinel survey_received through as empty, not a gate error (AC#3)', async () => {
    await refreshRegistryOverlay(fakeDb([surveyProbeRow]))
    const order = { ...nativeOrder, UnusedFields: { survey_received: '' } }
    const { canonical, valid } = mapFromExternal('survey_probe', order)
    expect(canonical).not.toBeNull()
    expect(valid).toBe(true)
    expect(canonical?.['surveyDate']).toBe('') // empty stays empty (default only fills a MISSING key)
  })

  it('the overlay mapping passes the publish gate reading the curated sub-path (AC#1)', () => {
    const base = getGateBase('survey_probe', 'shipment_status_update')!
    const report = runGatePipeline(base, {
      mapping: surveyProbeRow.mapping,
      rules: [],
      corpus: [
        {
          name: 'clean',
          input: {
            order: { ...nativeOrder, UnusedFields: { survey_received: '2024-06-01' } },
            action: 'save' as const,
          },
          expected: { valid: true, ruleIds: [] },
        },
      ],
    })
    expect(report.ok).toBe(true)
  })
})

describe('gate base + registry helpers', () => {
  it('getGateBase composes a bare base from a floor for a NEW partner id', () => {
    const base = getGateBase('brand_new_partner', 'shipment_status_update')!
    expect(base.floor).toBe('shipment_status_update')
    expect(base.id).toBe('brand_new_partner')
  })

  it('getGateBase returns undefined for an unknown id with no floor, or an unknown floor', () => {
    expect(getGateBase('ghost')).toBeUndefined()
    expect(getGateBase('ghost', 'no_such_floor')).toBeUndefined()
  })

  it('listFloorIds exposes the built-in floors', () => {
    expect(listFloorIds()).toContain('shipment_status_update')
  })

  it('listIntegrationIds includes built-ins and GLOBAL-overlay new-partner ids', async () => {
    expect(listIntegrationIds()).toEqual(expect.arrayContaining(['demo_partner', 'allied_status']))
    await refreshRegistryOverlay(
      fakeDb([
        {
          integrationId: 'acme_status',
          version: 1,
          floor: 'shipment_status_update',
          mapping: { serviceOrderNumber: 'InvolvedParties.ShipperEmployer.Identity.Description' },
          rules: [],
        },
      ]),
    )
    expect(listIntegrationIds()).toContain('acme_status')
  })

  it('loadRegistryOverlayIfStale swallows a DB error and keeps serving built-ins', async () => {
    const throwingDb = {
      integrationConfig: {
        findMany: async () => {
          throw new Error('db down')
        },
      },
    } as unknown as PC
    await loadRegistryOverlayIfStale(throwingDb, 0)
    expect(getBuiltInDefinition('demo_partner')!.floor).toBe('shipment_status_update')
  })

  it('mapToExternal throws UnknownIntegrationError for an unknown id', () => {
    expect(() => mapToExternal('nope', {})).toThrow(UnknownIntegrationError)
  })
})
