// ---------------------------------------------------------------------------
// Unit tests for the EVENT-trigger filter client validation (Phase 3 Unit 5).
// The dispatcher contract: shallow top-level strict equality, scalars only;
// empty/absent filter = match-all.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { parseTriggerFilter } from './trigger-filter'

describe('parseTriggerFilter', () => {
  it('treats empty text as match-all (filter omitted)', () => {
    expect(parseTriggerFilter('')).toEqual({ ok: true, filter: undefined })
    expect(parseTriggerFilter('   \n ')).toEqual({ ok: true, filter: undefined })
  })

  it('treats an empty object as match-all (filter omitted)', () => {
    expect(parseTriggerFilter('{}')).toEqual({ ok: true, filter: undefined })
  })

  it('accepts a flat object of scalars', () => {
    const result = parseTriggerFilter('{"status": "COMPLETED", "count": 3, "ok": true, "x": null}')
    expect(result).toEqual({
      ok: true,
      filter: { status: 'COMPLETED', count: 3, ok: true, x: null },
    })
  })

  it('rejects unparseable JSON', () => {
    const result = parseTriggerFilter('{status: COMPLETED}')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/valid JSON/)
  })

  it.each([
    ['"a string"', 'string'],
    ['42', 'number'],
    ['true', 'boolean'],
    ['null', 'null'],
    ['[1, 2]', 'array'],
  ])('rejects non-object JSON: %s (%s)', (text) => {
    const result = parseTriggerFilter(text)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/JSON object/)
  })

  it('rejects nested object values (can never match — strict equality)', () => {
    const result = parseTriggerFilter('{"move": {"status": "COMPLETED"}}')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('"move"')
    expect(result.error).toContain('an object')
  })

  it('rejects array values', () => {
    const result = parseTriggerFilter('{"statuses": ["A", "B"]}')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('"statuses"')
    expect(result.error).toContain('an array')
  })
})

describe('parseTriggerFilter — v2 structured dialect', () => {
  it('accepts a field rule', () => {
    const r = parseTriggerFilter('{"path":"status","op":"eq","value":"DONE"}')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.filter).toEqual({ path: 'status', op: 'eq', value: 'DONE' })
  })

  it('accepts all/any groups', () => {
    expect(
      parseTriggerFilter(
        '{"all":[{"path":"a","op":"eq","value":1},{"path":"b","op":"gt","value":2}]}',
      ).ok,
    ).toBe(true)
    expect(parseTriggerFilter('{"any":[{"path":"a","op":"exists"}]}').ok).toBe(true)
  })

  it('accepts in/nin with a scalar array', () => {
    expect(parseTriggerFilter('{"path":"s","op":"in","value":["A","B"]}').ok).toBe(true)
  })

  it('rejects an unknown operator', () => {
    const r = parseTriggerFilter('{"path":"s","op":"regex","value":".*"}')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/operator/i)
  })

  it('rejects in without a scalar array', () => {
    expect(parseTriggerFilter('{"path":"s","op":"in","value":"A"}').ok).toBe(false)
  })

  it('rejects a field rule without a path', () => {
    expect(parseTriggerFilter('{"op":"eq","value":1}').ok).toBe(false)
  })

  it('rejects a group that is both all and any', () => {
    expect(parseTriggerFilter('{"all":[],"any":[]}').ok).toBe(false)
  })
})
