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

  // sdk-feedback 0033 B — an unrecognized key used to validate clean and then do
  // nothing (e.g. `display: "faces"` before display existed), so `valid` said
  // nothing about whether a field would be honored.
  it('rejects an unknown question key, naming the key and the question', () => {
    const r = validateFormDefinition({
      questions: [{ id: 'q', type: 'rating', label: 'x', zzz_nonsense: 'x' }],
    })
    expect(r).toEqual({
      ok: false,
      errors: [
        'questions[0].zzz_nonsense is not a recognized key for a rating question (allowed: id, type, label, required, min, max, display, scaleLabels)',
      ],
    })
  })

  it('rejects a key that is legal on another type but not on this one', () => {
    const r = validateFormDefinition({
      questions: [
        { id: 'q1', type: 'text', label: 'x', display: 'faces' },
        { id: 'q2', type: 'boolean', label: 'x', options: ['a'] },
        { id: 'q3', type: 'select', label: 'x', options: ['a'], maxLength: 3 },
      ],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toHaveLength(3)
      expect(r.errors[0]).toContain('questions[0].display is not a recognized key for a text')
      expect(r.errors[1]).toContain('questions[1].options is not a recognized key for a boolean')
      expect(r.errors[2]).toContain('questions[2].maxLength is not a recognized key for a select')
    }
  })

  it('rejects an unknown top-level definition key', () => {
    const r = validateFormDefinition({ ...goodDefinition, theme: 'dark' })
    expect(r).toEqual({
      ok: false,
      errors: ['definition.theme is not a recognized key (allowed: questions)'],
    })
  })

  describe('rating display (0033 A)', () => {
    const rating = (extra: Record<string, unknown>) => ({
      questions: [{ id: 'q', type: 'rating', label: 'Rate it', ...extra }],
    })

    it.each(['faces', 'stars', 'numeric'])('accepts display: %s', (display) => {
      expect(validateFormDefinition(rating({ display }))).toEqual({ ok: true })
    })

    it('rejects an unknown display value', () => {
      expect(validateFormDefinition(rating({ display: 'emoji' }))).toEqual({
        ok: false,
        errors: ['questions[0].display must be one of faces, stars, numeric'],
      })
    })

    it('rejects faces on a scale wider than 7 points, accepts exactly 7', () => {
      expect(validateFormDefinition(rating({ display: 'faces', min: 1, max: 10 }))).toEqual({
        ok: false,
        errors: ['questions[0].display "faces" supports at most 7 points; this scale has 10'],
      })
      expect(validateFormDefinition(rating({ display: 'faces', min: 0, max: 6 }))).toEqual({
        ok: true,
      })
      // stars and numeric have no cap.
      expect(validateFormDefinition(rating({ display: 'stars', min: 1, max: 10 }))).toEqual({
        ok: true,
      })
    })

    it('measures the faces cap against the default 1..5 when bounds are omitted', () => {
      expect(validateFormDefinition(rating({ display: 'faces' }))).toEqual({ ok: true })
    })

    it('accepts scaleLabels keyed by points on the scale', () => {
      expect(
        validateFormDefinition(rating({ scaleLabels: { '1': 'Very poor', '5': 'Excellent' } })),
      ).toEqual({ ok: true })
    })

    it('rejects scaleLabels that are not an object of non-empty strings on the scale', () => {
      const r = validateFormDefinition({
        questions: [
          { id: 'a', type: 'rating', label: 'x', scaleLabels: ['Very poor'] },
          { id: 'b', type: 'rating', label: 'x', scaleLabels: { '9': 'Off scale' } },
          { id: 'c', type: 'rating', label: 'x', scaleLabels: { '1': '' } },
          { id: 'd', type: 'rating', label: 'x', scaleLabels: { low: 'x' } },
          // Would parse to 1, but the form looks labels up by "1": never rendered.
          { id: 'e', type: 'rating', label: 'x', scaleLabels: { '01': 'x' } },
        ],
      })
      expect(r).toEqual({
        ok: false,
        errors: [
          'questions[0].scaleLabels must be an object of scale point → label',
          'questions[1].scaleLabels["9"] is not a point on the 1..5 scale',
          'questions[2].scaleLabels["1"] must be a non-empty string',
          'questions[3].scaleLabels["low"] is not a point on the 1..5 scale',
          'questions[4].scaleLabels["01"] is not a point on the 1..5 scale',
        ],
      })
    })

    it('leaves the response contract unchanged: the answer is still an integer', () => {
      const plain = compileResponseSchema(rating({}))
      const faces = compileResponseSchema(
        rating({ display: 'faces', scaleLabels: { '1': 'Bad', '5': 'Great' } }),
      )
      expect(faces).toEqual(plain)
    })
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
