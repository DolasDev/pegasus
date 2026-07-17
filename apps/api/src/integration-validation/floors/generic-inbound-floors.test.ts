// ---------------------------------------------------------------------------
// Generic inbound-ingest floors (sdk-feedback 0024). Proves the four
// partner-neutral floors are honored by a PUBLISHED config overlay — the mapping
// + rules live in configuration, not code — and that the `nin` operator lets a
// config express partner value sets (AVL/NVL, ADE statuses, FILETYPES) without
// baking them into the floor. Sirva ADE is the exercising partner; the fixtures
// here mirror what platform/allied-vanlines/integrations/* publishes.
//
// Each floor is checked two ways:
//   1. runGatePipeline(floorBase, {mapping, rules, corpus}) is ok and each corpus
//      case reproduces its expected verdict — i.e. the floor exists and honors the
//      config (0024 AC1), and `nin` value-set rules fire correctly.
//   2. mapFromExternalWithDefinition returns the CANONICAL entity + the verdict —
//      the inbound runtime surface an ingest workflow consumes (0024 AC3).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { getGateBase } from '../registry'
import { runGatePipeline, type GateCorpusCase } from '../gate-pipeline'
import { compileMapping, type MappingTemplate } from '../transform/mapping-format'
import { mapFromExternalWithDefinition } from '../validate'
import type { IntegrationDefinition } from '../types'
import type { RuleSet } from '../rules/types'
import { SHIPMENT_LIFECYCLE_EVENT_FLOOR } from './shipment-lifecycle-event.floor'
import { SALES_LEAD_FLOOR } from './sales-lead.floor'
import { FINANCIAL_SETTLEMENT_FLOOR } from './financial-settlement.floor'
import { DOCUMENT_RECORD_FLOOR } from './document-record.floor'

/** Compose a runnable definition = floor ⊕ a published-config overlay (mapping+rules). */
function definitionOn(
  floorId: string,
  mapping: MappingTemplate,
  rules: RuleSet,
): IntegrationDefinition {
  const base = getGateBase(`test_${floorId}`, floorId)
  if (!base) throw new Error(`no floor "${floorId}"`)
  return { ...base, mapping, transform: compileMapping(mapping), rules }
}

// ── shipment_lifecycle_event (Sirva ADE Shipment Operational Event) ─────────

const shipmentMapping: MappingTemplate = {
  Id: { $from: 'RegNumber', coerce: 'toString' },
  Reference: {
    Brand: { $from: 'Brand', default: null },
    Number: { $from: 'RegNumber', coerce: 'toString' },
    Year: { $from: 'RegYear', coerce: 'toString' },
    CarrierRef: { $from: 'CamisRegNumber', default: null },
    TripId: { $from: 'CamisTripNumber', default: null },
  },
  Lifecycle: {
    EventType: { $from: 'Type', default: null },
    EventId: { $from: 'Id', default: null },
    EventDateTime: { $from: 'DateTime', default: null },
    Status: { $from: 'ShipmentStatus', default: null },
  },
  Dates: {
    Registration: { Actual: { $from: 'RegDate', default: null } },
    Load: { Actual: { $from: 'ActualCustLoadDate', default: null } },
    Delivery: { Actual: { $from: 'ActualCustDelvDate', default: null } },
  },
  Measures: {
    EstimatedWeight: { $from: 'WeightEstimate', coerce: 'toNumberOrNull' },
    ActualWeight: { $from: 'WeightActual', coerce: 'toNumberOrNull' },
  },
}

const shipmentRules: RuleSet = [
  {
    id: 'shipment-brand-valid',
    description: 'Brand must be AVL or NVL.',
    field: 'Reference.Brand',
    message: "Brand must be 'AVL' or 'NVL'.",
    when: [
      { fact: 'brandPresent', op: 'eq', value: true },
      { fact: 'brand', op: 'nin', value: ['AVL', 'NVL'] },
    ],
  },
  {
    id: 'shipment-reg-number-required',
    description: 'RegNumber is required.',
    field: 'Id',
    message: 'RegNumber is required.',
    when: [{ fact: 'idPresent', op: 'eq', value: false }],
  },
  {
    id: 'shipment-status-known',
    description: 'ShipmentStatus must be a known ADE status.',
    field: 'Lifecycle.Status',
    message: 'ShipmentStatus must be one of the ADE operational statuses.',
    when: [
      { fact: 'statusPresent', op: 'eq', value: true },
      {
        fact: 'status',
        op: 'nin',
        value: ['REGISTERED', 'CANCELLED', 'PLANNED', 'ASSIGNED', 'LOADED', 'DELIVERED'],
      },
    ],
  },
  {
    id: 'delivered-requires-delivery-actual',
    description: 'A DELIVERED shipment needs an actual delivery date.',
    field: 'Dates.Delivery.Actual',
    message: 'A DELIVERED shipment must carry an actual delivery date.',
    when: [
      { fact: 'status', op: 'eq', value: 'DELIVERED' },
      { fact: 'deliveryDatePresent', op: 'eq', value: false },
    ],
  },
]

const shipmentCorpus: GateCorpusCase[] = [
  {
    name: 'valid Loaded AVL',
    input: {
      order: {
        Brand: 'AVL',
        RegNumber: '111422',
        RegYear: '2014',
        ShipmentStatus: 'LOADED',
        ActualCustLoadDate: '2018-05-04',
      },
    },
    expected: { valid: true, ruleIds: [] },
  },
  {
    name: 'invalid brand',
    input: { order: { Brand: 'XYZ', RegNumber: '111422', ShipmentStatus: 'REGISTERED' } },
    expected: { valid: false, ruleIds: ['shipment-brand-valid'] },
  },
  {
    name: 'missing RegNumber',
    input: { order: { Brand: 'NVL', RegYear: '2014', ShipmentStatus: 'REGISTERED' } },
    expected: { valid: false, ruleIds: ['shipment-reg-number-required'] },
  },
  {
    name: 'unknown status',
    input: { order: { Brand: 'AVL', RegNumber: '111422', ShipmentStatus: 'IN_LIMBO' } },
    expected: { valid: false, ruleIds: ['shipment-status-known'] },
  },
  {
    name: 'DELIVERED without delivery actual',
    input: { order: { Brand: 'AVL', RegNumber: '111422', ShipmentStatus: 'DELIVERED' } },
    expected: { valid: false, ruleIds: ['delivered-requires-delivery-actual'] },
  },
  {
    name: 'DELIVERED with delivery actual',
    input: {
      order: {
        Brand: 'AVL',
        RegNumber: '111422',
        ShipmentStatus: 'DELIVERED',
        ActualCustDelvDate: '2018-05-09',
      },
    },
    expected: { valid: true, ruleIds: [] },
  },
]

// ── sales_lead ──────────────────────────────────────────────────────────────

const leadMapping: MappingTemplate = {
  Id: { $from: 'LeadId', coerce: 'toString' },
  Reference: {
    LeadId: { $from: 'LeadId', coerce: 'toString' },
    Brand: { $from: 'Brand', default: null },
  },
  Status: { $from: 'Status', default: null },
  Contact: { PrimaryPhoneType: { $from: 'PrimaryPhoneType', default: null } },
}
const leadRules: RuleSet = [
  {
    id: 'lead-status-known',
    description: 'Status must be a known ADE lead status.',
    field: 'Status',
    message: 'Status must be Converted, Dead, New, Unqualified, or Working.',
    when: [
      { fact: 'statusPresent', op: 'eq', value: true },
      { fact: 'status', op: 'nin', value: ['Converted', 'Dead', 'New', 'Unqualified', 'Working'] },
    ],
  },
  {
    id: 'lead-id-required',
    description: 'LeadId is required.',
    field: 'Id',
    message: 'LeadId is required.',
    when: [{ fact: 'idPresent', op: 'eq', value: false }],
  },
  {
    id: 'lead-primary-phone-type-known',
    description: 'PrimaryPhoneType must be Home/Work/Cell.',
    field: 'Contact.PrimaryPhoneType',
    message: 'PrimaryPhoneType must be Home, Work, or Cell.',
    when: [
      { fact: 'primaryPhoneTypePresent', op: 'eq', value: true },
      { fact: 'primaryPhoneType', op: 'nin', value: ['Home', 'Work', 'Cell'] },
    ],
  },
]
const leadCorpus: GateCorpusCase[] = [
  {
    name: 'valid New lead',
    input: { order: { Brand: 'AVL', LeadId: 'L-1001', Status: 'New', PrimaryPhoneType: 'Cell' } },
    expected: { valid: true, ruleIds: [] },
  },
  {
    name: 'unknown status',
    input: { order: { LeadId: 'L-1002', Status: 'Pending' } },
    expected: { valid: false, ruleIds: ['lead-status-known'] },
  },
  {
    name: 'missing LeadId (absent phone type does NOT fire)',
    input: { order: { Status: 'New' } },
    expected: { valid: false, ruleIds: ['lead-id-required'] },
  },
  {
    name: 'unknown phone type',
    input: { order: { LeadId: 'L-1003', Status: 'Working', PrimaryPhoneType: 'Pager' } },
    expected: { valid: false, ruleIds: ['lead-primary-phone-type-known'] },
  },
]

// ── financial_settlement ────────────────────────────────────────────────────

const compMapping: MappingTemplate = {
  Id: { $from: 'ShipmentNbr', coerce: 'toString' },
  Reference: {
    PartyId: { $from: 'AgentNbr', coerce: 'toString' },
    Brand: { $from: 'Brand', default: null },
  },
  Totals: { Credit: { $from: 'Credit', coerce: 'toNumberOrNull' } },
}
const compRules: RuleSet = [
  {
    id: 'comp-agent-nbr-required',
    description: 'AgentNbr required.',
    field: 'Reference.PartyId',
    message: 'AgentNbr is required.',
    when: [{ fact: 'partyIdPresent', op: 'eq', value: false }],
  },
  {
    id: 'comp-shipment-nbr-required',
    description: 'ShipmentNbr required.',
    field: 'Id',
    message: 'ShipmentNbr is required.',
    when: [{ fact: 'idPresent', op: 'eq', value: false }],
  },
  {
    id: 'comp-brand-valid',
    description: 'Brand must be AVL or NVL.',
    field: 'Reference.Brand',
    message: "Brand must be 'AVL' or 'NVL'.",
    when: [
      { fact: 'brandPresent', op: 'eq', value: true },
      { fact: 'brand', op: 'nin', value: ['AVL', 'NVL'] },
    ],
  },
]
const compCorpus: GateCorpusCase[] = [
  {
    name: 'valid rated shipment',
    input: { order: { AgentNbr: '0008000', ShipmentNbr: '456721', Brand: 'AVL' } },
    expected: { valid: true, ruleIds: [] },
  },
  {
    name: 'missing AgentNbr',
    input: { order: { ShipmentNbr: '456721', Brand: 'AVL' } },
    expected: { valid: false, ruleIds: ['comp-agent-nbr-required'] },
  },
  {
    name: 'missing ShipmentNbr',
    input: { order: { AgentNbr: '0008000', Brand: 'NVL' } },
    expected: { valid: false, ruleIds: ['comp-shipment-nbr-required'] },
  },
  {
    name: 'invalid brand',
    input: { order: { AgentNbr: '0008000', ShipmentNbr: '456721', Brand: 'ZZZ' } },
    expected: { valid: false, ruleIds: ['comp-brand-valid'] },
  },
]

// ── document_record ─────────────────────────────────────────────────────────

const docMapping: MappingTemplate = {
  Id: { $from: 'Id', coerce: 'toString' },
  Reference: { Brand: { $from: 'Brand', default: null } },
  Format: { $from: 'FileType', default: null },
}
const docRules: RuleSet = [
  {
    id: 'document-id-required',
    description: 'Document Id required.',
    field: 'Id',
    message: 'Document Id is required.',
    when: [{ fact: 'idPresent', op: 'eq', value: false }],
  },
  {
    id: 'document-file-type-known',
    description: 'FileType must be a known ADE FILETYPE.',
    field: 'Format',
    message: 'FileType must be a known ADE FILETYPE.',
    when: [
      { fact: 'formatPresent', op: 'eq', value: true },
      {
        fact: 'format',
        op: 'nin',
        value: [
          'DOC',
          'DOCX',
          'GIF',
          'HTM',
          'HTML',
          'JPEG',
          'JPG',
          'MSG',
          'PDF',
          'PNG',
          'TIF',
          'TIFF',
          'TXT',
          'XLS',
          'XLSX',
        ],
      },
    ],
  },
  {
    id: 'document-brand-valid',
    description: 'Brand must be AVL or NVL.',
    field: 'Reference.Brand',
    message: "Brand must be 'AVL' or 'NVL'.",
    when: [
      { fact: 'brandPresent', op: 'eq', value: true },
      { fact: 'brand', op: 'nin', value: ['AVL', 'NVL'] },
    ],
  },
]
const docCorpus: GateCorpusCase[] = [
  {
    name: 'valid MSG doc',
    input: { order: { Id: '93953304', FileType: 'MSG', Brand: 'AVL' } },
    expected: { valid: true, ruleIds: [] },
  },
  {
    name: 'unknown FileType',
    input: { order: { Id: '93953305', FileType: 'ZIP', Brand: 'AVL' } },
    expected: { valid: false, ruleIds: ['document-file-type-known'] },
  },
  {
    name: 'missing Id',
    input: { order: { FileType: 'PDF', Brand: 'NVL' } },
    expected: { valid: false, ruleIds: ['document-id-required'] },
  },
  {
    name: 'invalid brand',
    input: { order: { Id: '93953306', FileType: 'PDF', Brand: 'QQQ' } },
    expected: { valid: false, ruleIds: ['document-brand-valid'] },
  },
]

const FLOORS = [
  {
    floor: SHIPMENT_LIFECYCLE_EVENT_FLOOR,
    mapping: shipmentMapping,
    rules: shipmentRules,
    corpus: shipmentCorpus,
  },
  { floor: SALES_LEAD_FLOOR, mapping: leadMapping, rules: leadRules, corpus: leadCorpus },
  { floor: FINANCIAL_SETTLEMENT_FLOOR, mapping: compMapping, rules: compRules, corpus: compCorpus },
  { floor: DOCUMENT_RECORD_FLOOR, mapping: docMapping, rules: docRules, corpus: docCorpus },
]

describe('generic inbound floors are honored by a published config (0024)', () => {
  it.each(FLOORS)(
    '$floor: config maps + rules gate-pass against its corpus',
    ({ floor, mapping, rules, corpus }) => {
      const base = getGateBase(`test_${floor}`, floor)
      expect(base, `floor "${floor}" is registered`).toBeDefined()
      const report = runGatePipeline(base!, { mapping, rules, corpus })
      expect(report.problems).toEqual([])
      expect(report.corpus.failures).toEqual([])
      expect(report.ok).toBe(true)
    },
  )

  it('map_from_external returns the canonical entity + a passing verdict for a valid shipment', () => {
    const def = definitionOn(SHIPMENT_LIFECYCLE_EVENT_FLOOR, shipmentMapping, shipmentRules)
    const res = mapFromExternalWithDefinition(def, {
      Brand: 'AVL',
      RegNumber: '111422',
      RegYear: '2014',
      ShipmentStatus: 'LOADED',
    })
    expect(res.valid).toBe(true)
    expect(res.issues).toEqual([])
    expect(res.canonical).toMatchObject({
      Id: '111422',
      Reference: { Brand: 'AVL', Number: '111422', Year: '2014' },
      Lifecycle: { Status: 'LOADED' },
    })
  })

  it('map_from_external returns canonical + a failing verdict (fails closed on the verdict, not the entity)', () => {
    const def = definitionOn(SHIPMENT_LIFECYCLE_EVENT_FLOOR, shipmentMapping, shipmentRules)
    const res = mapFromExternalWithDefinition(def, {
      Brand: 'XYZ',
      RegNumber: '111422',
      ShipmentStatus: 'LOADED',
    })
    expect(res.valid).toBe(false)
    expect(res.issues.map((i) => i.ruleId)).toContain('shipment-brand-valid')
    // The canonical is still returned so the caller sees what was mapped.
    expect(res.canonical).toMatchObject({ Reference: { Brand: 'XYZ' } })
  })
})
