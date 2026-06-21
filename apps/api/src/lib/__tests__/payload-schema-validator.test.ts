// ---------------------------------------------------------------------------
// Unit tests for the dependency-free payload-schema validator — pure, no DB.
// Two surfaces: validatePayloadSchema (is the schema supported?) and
// validatePayload (does data satisfy it?).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { validatePayloadSchema, validatePayload } from '../payload-schema-validator'

describe('validatePayloadSchema (meta-check)', () => {
  it('accepts a supported object schema', () => {
    const r = validatePayloadSchema({
      type: 'object',
      properties: { leadId: { type: 'string' }, score: { type: 'integer', minimum: 0 } },
      required: ['leadId'],
      additionalProperties: false,
    })
    expect(r.ok).toBe(true)
  })

  it('rejects an unsupported keyword (fail closed)', () => {
    const r = validatePayloadSchema({ type: 'object', oneOf: [] })
    expect(r.ok).toBe(false)
  })

  it('rejects an unknown type', () => {
    const r = validatePayloadSchema({ type: 'date' })
    expect(r.ok).toBe(false)
  })

  it('rejects a non-object schema and an invalid pattern', () => {
    expect(validatePayloadSchema('nope').ok).toBe(false)
    expect(validatePayloadSchema({ type: 'string', pattern: '(' }).ok).toBe(false)
  })

  it('rejects malformed structural keywords', () => {
    expect(validatePayloadSchema({ properties: [] }).ok).toBe(false)
    expect(validatePayloadSchema({ required: 'leadId' }).ok).toBe(false)
    expect(validatePayloadSchema({ additionalProperties: 'no' }).ok).toBe(false)
    expect(validatePayloadSchema({ enum: 'a' }).ok).toBe(false)
    expect(validatePayloadSchema({ minLength: 'x' }).ok).toBe(false)
    expect(validatePayloadSchema({ pattern: 5 }).ok).toBe(false)
  })

  it('accepts a union type array and a valid pattern', () => {
    expect(validatePayloadSchema({ type: ['string', 'null'] }).ok).toBe(true)
    expect(validatePayloadSchema({ type: 'string', pattern: '^[a-z]+$' }).ok).toBe(true)
  })

  it('recurses into nested properties and items', () => {
    expect(
      validatePayloadSchema({
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' } } },
      }).ok,
    ).toBe(true)
    expect(
      validatePayloadSchema({
        type: 'object',
        properties: { bad: { type: 'object', properties: { x: { type: 'nope' } } } },
      }).ok,
    ).toBe(false)
  })
})

describe('validatePayload (data-check)', () => {
  const schema = {
    type: 'object',
    properties: {
      leadId: { type: 'string', minLength: 1 },
      score: { type: 'integer', minimum: 0, maximum: 100 },
      stage: { type: 'string', enum: ['new', 'qualified', 'won'] },
      tags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    },
    required: ['leadId'],
    additionalProperties: false,
  }

  it('accepts a valid payload', () => {
    const r = validatePayload(schema, {
      leadId: 'lead-1',
      score: 80,
      stage: 'qualified',
      tags: ['a', 'b'],
    })
    expect(r.ok).toBe(true)
  })

  it('flags a missing required property', () => {
    const r = validatePayload(schema, { score: 10 })
    expect(r.ok).toBe(false)
  })

  it('flags a type mismatch', () => {
    const r = validatePayload(schema, { leadId: 123 })
    expect(r.ok).toBe(false)
  })

  it('flags an out-of-range number and a bad enum', () => {
    expect(validatePayload(schema, { leadId: 'x', score: 200 }).ok).toBe(false)
    expect(validatePayload(schema, { leadId: 'x', stage: 'lost' }).ok).toBe(false)
  })

  it('flags an additional property when additionalProperties is false', () => {
    const r = validatePayload(schema, { leadId: 'x', surprise: true })
    expect(r.ok).toBe(false)
  })

  it('flags too many array items and a wrong item type', () => {
    expect(validatePayload(schema, { leadId: 'x', tags: ['a', 'b', 'c', 'd'] }).ok).toBe(false)
    expect(validatePayload(schema, { leadId: 'x', tags: [1] }).ok).toBe(false)
  })

  it('treats integer as a number for number-typed fields', () => {
    expect(
      validatePayload({ type: 'object', properties: { n: { type: 'number' } } }, { n: 5 }).ok,
    ).toBe(true)
  })

  it('enforces minimum, minItems, and string constraints at the top level', () => {
    expect(validatePayload({ type: 'number', minimum: 10 }, 5).ok).toBe(false)
    expect(validatePayload({ type: 'number', maximum: 10 }, 5).ok).toBe(true)
    expect(
      validatePayload({ type: 'array', items: { type: 'string' }, minItems: 2 }, ['a']).ok,
    ).toBe(false)
    expect(validatePayload({ type: 'string', minLength: 3 }, 'ab').ok).toBe(false)
    expect(validatePayload({ type: 'string', pattern: '^x' }, 'yz').ok).toBe(false)
  })

  it('accepts a value matching one branch of a union type', () => {
    expect(validatePayload({ type: ['string', 'null'] }, null).ok).toBe(true)
    expect(validatePayload({ type: ['string', 'null'] }, 'x').ok).toBe(true)
    expect(validatePayload({ type: ['string', 'null'] }, 5).ok).toBe(false)
  })
})
