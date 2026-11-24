import { describe, it, expect } from 'vitest'
import { DomainError } from '../../shared/errors'
import {
  SUPPORT_THREAD_STATUSES,
  MAX_SUPPORT_BODY_LENGTH,
  MAX_SUPPORT_SUBJECT_LENGTH,
  OPERATOR_ALERT_INTERVAL_MS,
  validateSupportSubject,
  validateSupportBody,
  isSupportThreadStatus,
  statusAfterMessage,
  shouldAlertOperator,
  sanitizeSupportContext,
  subjectFromBody,
} from '../index'

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (err) {
    if (err instanceof DomainError) return err.code
    throw err
  }
  return undefined
}

describe('validateSupportSubject', () => {
  it('trims and collapses whitespace to one line', () => {
    expect(validateSupportSubject('  Invoice   totals\nlook wrong ')).toBe(
      'Invoice totals look wrong',
    )
  })

  it('rejects an empty subject', () => {
    expect(codeOf(() => validateSupportSubject('   '))).toBe('SUPPORT_SUBJECT_EMPTY')
    expect(codeOf(() => validateSupportSubject(undefined))).toBe('SUPPORT_SUBJECT_EMPTY')
  })

  it('rejects a subject over the limit', () => {
    const long = 'x'.repeat(MAX_SUPPORT_SUBJECT_LENGTH + 1)
    expect(codeOf(() => validateSupportSubject(long))).toBe('SUPPORT_SUBJECT_TOO_LONG')
    expect(validateSupportSubject('x'.repeat(MAX_SUPPORT_SUBJECT_LENGTH))).toHaveLength(
      MAX_SUPPORT_SUBJECT_LENGTH,
    )
  })
})

describe('validateSupportBody', () => {
  it('trims and normalizes line endings, keeping newlines', () => {
    expect(validateSupportBody('  line one\r\nline two  ')).toBe('line one\nline two')
  })

  it('rejects empty and non-string bodies', () => {
    expect(codeOf(() => validateSupportBody(''))).toBe('SUPPORT_BODY_EMPTY')
    expect(codeOf(() => validateSupportBody(42))).toBe('SUPPORT_BODY_EMPTY')
  })

  it('rejects a body over the limit', () => {
    expect(codeOf(() => validateSupportBody('x'.repeat(MAX_SUPPORT_BODY_LENGTH + 1)))).toBe(
      'SUPPORT_BODY_TOO_LONG',
    )
  })
})

describe('subjectFromBody', () => {
  it('uses the first line of the body', () => {
    expect(subjectFromBody('Cannot save a trip\nIt spins forever')).toBe('Cannot save a trip')
  })

  it('cuts a long first line at the subject limit with an ellipsis', () => {
    const out = subjectFromBody('y'.repeat(500))
    expect(out.length).toBe(MAX_SUPPORT_SUBJECT_LENGTH)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('isSupportThreadStatus', () => {
  it('accepts every declared status and nothing else', () => {
    for (const s of SUPPORT_THREAD_STATUSES) expect(isSupportThreadStatus(s)).toBe(true)
    expect(isSupportThreadStatus('open')).toBe(false)
    expect(isSupportThreadStatus(null)).toBe(false)
  })
})

describe('statusAfterMessage', () => {
  it('a customer message always leaves the thread waiting on the operator', () => {
    expect(statusAfterMessage('awaiting_customer', 'customer')).toBe('awaiting_operator')
    expect(statusAfterMessage('awaiting_operator', 'customer')).toBe('awaiting_operator')
    // Writing on a resolved thread reopens it.
    expect(statusAfterMessage('resolved', 'customer')).toBe('awaiting_operator')
  })

  it('an operator message leaves the thread waiting on the customer', () => {
    expect(statusAfterMessage('awaiting_operator', 'operator')).toBe('awaiting_customer')
    expect(statusAfterMessage('resolved', 'operator')).toBe('awaiting_customer')
  })
})

describe('shouldAlertOperator', () => {
  const now = new Date('2026-11-24T12:00:00Z')

  it('alerts for a brand-new thread', () => {
    expect(shouldAlertOperator({ previousStatus: null, lastAlertAt: null, now })).toBe(true)
  })

  it('alerts when the message moves the thread into awaiting_operator', () => {
    const recent = new Date(now.getTime() - 60_000)
    expect(
      shouldAlertOperator({ previousStatus: 'awaiting_customer', lastAlertAt: recent, now }),
    ).toBe(true)
    expect(shouldAlertOperator({ previousStatus: 'resolved', lastAlertAt: recent, now })).toBe(true)
  })

  it('stays quiet while the customer keeps writing within the interval', () => {
    const recent = new Date(now.getTime() - OPERATOR_ALERT_INTERVAL_MS + 1000)
    expect(
      shouldAlertOperator({ previousStatus: 'awaiting_operator', lastAlertAt: recent, now }),
    ).toBe(false)
  })

  it('alerts again once the interval has passed', () => {
    const old = new Date(now.getTime() - OPERATOR_ALERT_INTERVAL_MS)
    expect(
      shouldAlertOperator({ previousStatus: 'awaiting_operator', lastAlertAt: old, now }),
    ).toBe(true)
    expect(
      shouldAlertOperator({ previousStatus: 'awaiting_operator', lastAlertAt: null, now }),
    ).toBe(true)
  })
})

describe('sanitizeSupportContext', () => {
  it('keeps well-formed values', () => {
    expect(
      sanitizeSupportContext({
        pageUrl: 'https://app.example.com/planning?x=1',
        userAgent: 'Mozilla/5.0',
        appVersion: '1.2.3',
      }),
    ).toEqual({
      pageUrl: 'https://app.example.com/planning?x=1',
      userAgent: 'Mozilla/5.0',
      appVersion: '1.2.3',
    })
  })

  it('drops a non-http(s) or unparsable page URL instead of failing the message', () => {
    expect(sanitizeSupportContext({ pageUrl: 'javascript:alert(1)' }).pageUrl).toBeNull()
    expect(sanitizeSupportContext({ pageUrl: 'not a url' }).pageUrl).toBeNull()
  })

  it('cuts over-long values and nulls missing or non-string ones', () => {
    const out = sanitizeSupportContext({ userAgent: 'u'.repeat(2000), appVersion: 7 })
    expect(out.userAgent).toHaveLength(500)
    expect(out.appVersion).toBeNull()
    expect(sanitizeSupportContext({ userAgent: '   ' }).userAgent).toBeNull()
    expect(sanitizeSupportContext(undefined)).toEqual({
      pageUrl: null,
      userAgent: null,
      appVersion: null,
    })
  })
})
