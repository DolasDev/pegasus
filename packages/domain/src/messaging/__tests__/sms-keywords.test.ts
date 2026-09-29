import { describe, it, expect } from 'vitest'
import { classifySmsKeyword, SMS_OPT_OUT_KEYWORDS, SMS_OPT_IN_KEYWORDS } from '../index'

describe('classifySmsKeyword', () => {
  it.each([
    'STOP',
    'stop',
    'Stop!',
    ' STOP ',
    'STOP 1',
    'stop calling me',
    'STOPALL',
    'Unsubscribe.',
    'cancel',
    'END',
    'quit',
    'REVOKE',
    'OPTOUT',
  ])('%j is an opt-out', (body) => {
    expect(classifySmsKeyword(body)).toBe('OPT_OUT')
  })

  it.each(['START', 'start', 'Unstop'])('%j is an opt-in', (body) => {
    expect(classifySmsKeyword(body)).toBe('OPT_IN')
  })

  it.each([
    'Ended up great, 5!',
    'Stopped by at 4pm',
    '5',
    'yes',
    'YES please',
    'Please stop by tomorrow? no — kidding, 5',
    'Can you cancel the storage?',
    '',
    '   ',
    '🛑',
  ])('%j is not a keyword', (body) => {
    // Only the FIRST token counts: "Please stop…" and "Can you cancel…" are
    // conversation, not an instruction to the carrier.
    expect(classifySmsKeyword(body)).toBeNull()
  })

  it('treats a missing body as no keyword', () => {
    expect(classifySmsKeyword(undefined)).toBeNull()
    expect(classifySmsKeyword(null)).toBeNull()
  })

  it('never lets YES re-subscribe', () => {
    expect(SMS_OPT_IN_KEYWORDS).not.toContain('YES')
  })

  it('keeps the two keyword sets disjoint', () => {
    expect(SMS_OPT_OUT_KEYWORDS.filter((k) => SMS_OPT_IN_KEYWORDS.includes(k))).toEqual([])
  })
})
