// ---------------------------------------------------------------------------
// Unit tests for the feedback form definition helpers — the authoring-time
// validator, the response-schema compiler, and the message-template renderer.
// Pure functions, no I/O.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import {
  validateFormDefinition,
  compileResponseSchema,
  renderMessageTemplate,
} from './feedback-form'
import { validatePayload } from './payload-schema-validator'

const goodDefinition = {
  questions: [
    { id: 'rating', type: 'rating', label: 'Rate the crew', required: true },
    { id: 'comments', type: 'text', label: 'Anything else?', maxLength: 500 },
    { id: 'again', type: 'boolean', label: 'Would you book again?' },
    {
      id: 'channel',
      type: 'select',
      label: 'How did you hear about us?',
      options: ['ad', 'friend'],
    },
    { id: 'crew_size', type: 'number', label: 'Crew size', min: 1, max: 10 },
  ],
}

describe('validateFormDefinition', () => {
  it('accepts a well-formed definition', () => {
    expect(validateFormDefinition(goodDefinition)).toEqual({ ok: true })
  })

  it('rejects a non-object / missing questions', () => {
    expect(validateFormDefinition(null).ok).toBe(false)
    expect(validateFormDefinition({}).ok).toBe(false)
    expect(validateFormDefinition({ questions: [] }).ok).toBe(false)
  })

  it('rejects a bad question id, duplicate id, unknown type, and empty label', () => {
    const r = validateFormDefinition({
      questions: [
        { id: 'Bad Id', type: 'rating', label: 'x' },
        { id: 'dup', type: 'text', label: 'a' },
        { id: 'dup', type: 'text', label: 'b' },
        { id: 'q4', type: 'stars', label: 'x' },
        { id: 'q5', type: 'text', label: '' },
      ],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('.id must be a slug'))).toBe(true)
      expect(r.errors.some((e) => e.includes('duplicated'))).toBe(true)
      expect(r.errors.some((e) => e.includes('.type must be one of'))).toBe(true)
      expect(r.errors.some((e) => e.includes('.label must be a non-empty'))).toBe(true)
    }
  })

  it('rejects a select without options and a rating with min > max', () => {
    expect(
      validateFormDefinition({ questions: [{ id: 'q', type: 'select', label: 'x' }] }).ok,
    ).toBe(false)
    expect(
      validateFormDefinition({
        questions: [{ id: 'q', type: 'rating', label: 'x', min: 5, max: 1 }],
      }).ok,
    ).toBe(false)
  })
})

describe('compileResponseSchema → validatePayload round-trip', () => {
  const schema = compileResponseSchema(goodDefinition)

  it('accepts a valid response', () => {
    const r = validatePayload(schema, {
      rating: 4,
      comments: 'great job',
      again: true,
      channel: 'friend',
      crew_size: 3,
    })
    expect(r).toEqual({ ok: true })
  })

  it('enforces the rating default 1..5 bounds and integer type', () => {
    expect(validatePayload(schema, { rating: 6 }).ok).toBe(false)
    expect(validatePayload(schema, { rating: 0 }).ok).toBe(false)
    expect(validatePayload(schema, { rating: 'four' }).ok).toBe(false)
  })

  it('requires a required question and rejects unknown keys', () => {
    expect(validatePayload(schema, { comments: 'hi' }).ok).toBe(false) // missing required rating
    expect(validatePayload(schema, { rating: 3, surprise: 1 }).ok).toBe(false) // additionalProperties:false
  })

  it('enforces select enum, number bounds, and text maxLength', () => {
    expect(validatePayload(schema, { rating: 3, channel: 'nope' }).ok).toBe(false)
    expect(validatePayload(schema, { rating: 3, crew_size: 99 }).ok).toBe(false)
    expect(validatePayload(schema, { rating: 3, comments: 'x'.repeat(501) }).ok).toBe(false)
  })
})

describe('renderMessageTemplate', () => {
  it('substitutes {{url}} and {{subjectId}} and leaves other text verbatim', () => {
    const out = renderMessageTemplate('Hi — rate move {{subjectId}}: {{url}} thanks', {
      url: 'https://x/f/tok',
      subjectId: '123',
    })
    expect(out).toBe('Hi — rate move 123: https://x/f/tok thanks')
  })

  it('replaces every occurrence', () => {
    expect(renderMessageTemplate('{{url}} {{url}}', { url: 'U', subjectId: 'S' })).toBe('U U')
  })
})
