import { describe, it, expect } from 'vitest'
import {
  toMessageId,
  toRingCentralConnectionId,
  toSubscriptionId,
  toSmsThreadId,
  isValidE164,
  toPhoneNumber,
  dedupeKey,
  isSms,
  normalizeThreadEntry,
  normalizeV1Message,
  canForward,
  canTransitionForward,
  deriveMessageStatus,
  isWebhookValidationHandshake,
  VALIDATION_TOKEN_HEADER,
  MESSAGE_STATUSES,
  FORWARD_STATUSES,
  type ThreadEntryInput,
  type ThreadPhonePair,
  type V1MessageInput,
  type Message,
  type ForwardStatus,
} from '../index'
import { DomainError } from '../../shared/errors'

// ---------------------------------------------------------------------------
// Branded ID factories
// ---------------------------------------------------------------------------

describe('messaging — branded id factories', () => {
  it('coerce raw strings to branded ids', () => {
    expect(toMessageId('m-1')).toBe('m-1')
    expect(toRingCentralConnectionId('c-1')).toBe('c-1')
    expect(toSubscriptionId('s-1')).toBe('s-1')
    expect(toSmsThreadId('t-1')).toBe('t-1')
  })
})

// ---------------------------------------------------------------------------
// PhoneNumber (E.164)
// ---------------------------------------------------------------------------

describe('messaging — PhoneNumber', () => {
  it('accepts valid E.164 numbers', () => {
    expect(isValidE164('+19085760908')).toBe(true)
    expect(isValidE164('+447911123456')).toBe(true)
    expect(toPhoneNumber('+19085760908')).toBe('+19085760908')
  })

  it('rejects invalid numbers', () => {
    expect(isValidE164('19085760908')).toBe(false) // no +
    expect(isValidE164('+0908576')).toBe(false) // leading 0 after +
    expect(isValidE164('+1908')).toBe(false) // too short
    expect(isValidE164('+1-908-576-0908')).toBe(false) // punctuation
    expect(isValidE164('')).toBe(false)
  })

  it('throws DomainError with INVALID_PHONE_NUMBER on bad input', () => {
    expect(() => toPhoneNumber('555-1234')).toThrowError(DomainError)
    try {
      toPhoneNumber('555-1234')
    } catch (e) {
      expect((e as DomainError).code).toBe('INVALID_PHONE_NUMBER')
    }
  })
})

// ---------------------------------------------------------------------------
// dedupeKey / isSms
// ---------------------------------------------------------------------------

describe('messaging — dedupeKey', () => {
  it('is store-scoped so the same id in different stores never collides', () => {
    expect(dedupeKey('THREAD_STORE', '123')).toBe('THREAD_STORE:123')
    expect(dedupeKey('V1_STORE', '123')).toBe('V1_STORE:123')
    expect(dedupeKey('THREAD_STORE', '123')).not.toBe(dedupeKey('V1_STORE', '123'))
  })
})

describe('messaging — isSms', () => {
  it('treats absent type as SMS and rejects known non-SMS', () => {
    expect(isSms('SMS')).toBe(true)
    expect(isSms(undefined)).toBe(true)
    expect(isSms('Fax')).toBe(false)
    expect(isSms('VoiceMail')).toBe(false)
    expect(isSms('MMS')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// normalizeThreadEntry
// ---------------------------------------------------------------------------

const threadEntry = (overrides: Partial<ThreadEntryInput> = {}): ThreadEntryInput => ({
  id: '9001',
  threadId: 't-42',
  creationTime: '2026-06-02T10:00:00.000Z',
  lastModifiedTime: '2026-06-02T10:00:01.000Z',
  direction: 'Inbound',
  subject: 'hello there',
  type: 'SMS',
  ...overrides,
})

const phones: ThreadPhonePair = { from: '+19085760908', to: '+12015550123' }

describe('messaging — normalizeThreadEntry', () => {
  it('normalizes an inbound thread SMS with its resolved phone pair', () => {
    const m = normalizeThreadEntry(threadEntry(), phones)
    expect(m.source).toBe('THREAD_STORE')
    expect(m.externalId).toBe('9001')
    expect(m.threadId).toBe('t-42')
    expect(m.direction).toBe('INBOUND')
    expect(m.fromNumber).toBe('+19085760908')
    expect(m.toNumber).toBe('+12015550123')
    expect(m.body).toBe('hello there')
    expect(m.rcCreationTime).toEqual(new Date('2026-06-02T10:00:00.000Z'))
    expect(m.rcLastModifiedTime).toEqual(new Date('2026-06-02T10:00:01.000Z'))
  })

  it('maps Outbound direction', () => {
    const m = normalizeThreadEntry(threadEntry({ direction: 'Outbound' }), phones)
    expect(m.direction).toBe('OUTBOUND')
  })

  it('prefers the thread `text` field over `subject` for the body', () => {
    const m = normalizeThreadEntry(
      threadEntry({ text: 'from text', subject: 'from subject' }),
      phones,
    )
    expect(m.body).toBe('from text')
  })

  it('falls back to `subject` when `text` is absent', () => {
    const m = normalizeThreadEntry(threadEntry({ subject: 'only subject' }), phones)
    expect(m.body).toBe('only subject')
  })

  it('throws INVALID_TIMESTAMP for an unparseable creationTime', () => {
    try {
      normalizeThreadEntry(threadEntry({ creationTime: 'not-a-date' }), phones)
      expect.unreachable()
    } catch (e) {
      expect((e as DomainError).code).toBe('INVALID_TIMESTAMP')
    }
  })

  it('throws INVALID_DIRECTION for an unexpected direction value', () => {
    try {
      normalizeThreadEntry(threadEntry({ direction: 'inbound' as never }), phones)
      expect.unreachable()
    } catch (e) {
      expect((e as DomainError).code).toBe('INVALID_DIRECTION')
    }
  })

  it('omits body and lastModified when absent', () => {
    const entry = threadEntry()
    delete (entry as { subject?: string }).subject
    delete (entry as { lastModifiedTime?: string }).lastModifiedTime
    const m = normalizeThreadEntry(entry, phones)
    expect('body' in m).toBe(false)
    expect('rcLastModifiedTime' in m).toBe(false)
  })

  it('coerces a numeric-string id via String()', () => {
    const m = normalizeThreadEntry(threadEntry({ id: '12345' }), phones)
    expect(m.externalId).toBe('12345')
  })

  it('throws UNSUPPORTED_MESSAGE_TYPE for non-SMS', () => {
    try {
      normalizeThreadEntry(threadEntry({ type: 'Fax' }), phones)
      expect.unreachable()
    } catch (e) {
      expect((e as DomainError).code).toBe('UNSUPPORTED_MESSAGE_TYPE')
    }
  })

  it('throws INVALID_PHONE_NUMBER for a non-E.164 resolved number', () => {
    try {
      normalizeThreadEntry(threadEntry(), { from: '5551234', to: '+12015550123' })
      expect.unreachable()
    } catch (e) {
      expect((e as DomainError).code).toBe('INVALID_PHONE_NUMBER')
    }
  })
})

// ---------------------------------------------------------------------------
// normalizeV1Message
// ---------------------------------------------------------------------------

const v1msg = (overrides: Partial<V1MessageInput> = {}): V1MessageInput => ({
  id: 7777,
  creationTime: '2026-05-31T08:00:00.000Z',
  lastModifiedTime: '2026-05-31T08:00:00.000Z',
  direction: 'Outbound',
  type: 'SMS',
  subject: 'your crew is on the way',
  from: { phoneNumber: '+19085760908' },
  to: [{ phoneNumber: '+12015550123' }],
  ...overrides,
})

describe('messaging — normalizeV1Message', () => {
  it('normalizes an outbound v1 SMS', () => {
    const m = normalizeV1Message(v1msg())
    expect(m.source).toBe('V1_STORE')
    expect(m.externalId).toBe('7777')
    expect(m.threadId).toBeUndefined()
    expect(m.direction).toBe('OUTBOUND')
    expect(m.fromNumber).toBe('+19085760908')
    expect(m.toNumber).toBe('+12015550123')
    expect(m.body).toBe('your crew is on the way')
  })

  it('throws INVALID_PHONE_NUMBER when from/to missing', () => {
    try {
      normalizeV1Message(v1msg({ to: [] }))
      expect.unreachable()
    } catch (e) {
      expect((e as DomainError).code).toBe('INVALID_PHONE_NUMBER')
    }
  })

  it('skips non-phone `to` entries (extensionId only) and picks the first real number', () => {
    const m = normalizeV1Message(v1msg({ to: [{}, { phoneNumber: '+12015550123' }] }))
    expect(m.toNumber).toBe('+12015550123')
  })

  it('throws UNSUPPORTED_MESSAGE_TYPE for a fax', () => {
    try {
      normalizeV1Message(v1msg({ type: 'Fax' }))
      expect.unreachable()
    } catch (e) {
      expect((e as DomainError).code).toBe('UNSUPPORTED_MESSAGE_TYPE')
    }
  })

  it('rejects a v1 record with an absent type (strict SMS for the v1 store)', () => {
    const typeless = v1msg()
    delete (typeless as { type?: string }).type
    try {
      normalizeV1Message(typeless)
      expect.unreachable()
    } catch (e) {
      expect((e as DomainError).code).toBe('UNSUPPORTED_MESSAGE_TYPE')
    }
  })
})

// ---------------------------------------------------------------------------
// canForward + forward-status transitions
// ---------------------------------------------------------------------------

const msg = (overrides: Partial<Pick<Message, 'forwardStatus' | 'body'>>) => ({
  forwardStatus: 'PENDING' as ForwardStatus,
  body: 'hi',
  ...overrides,
})

describe('messaging — canForward', () => {
  it('forwards PENDING and FAILED rows that still have a body', () => {
    expect(canForward(msg({ forwardStatus: 'PENDING' }))).toBe(true)
    expect(canForward(msg({ forwardStatus: 'FAILED' }))).toBe(true)
  })

  it('does not forward SENT or DEAD rows', () => {
    expect(canForward(msg({ forwardStatus: 'SENT' }))).toBe(false)
    expect(canForward(msg({ forwardStatus: 'DEAD' }))).toBe(false)
  })

  it('does not forward a purged (body-less) row', () => {
    expect(canForward({ forwardStatus: 'PENDING' })).toBe(false)
  })
})

describe('messaging — canTransitionForward', () => {
  it('allows the happy path and retry/dead-letter edges', () => {
    expect(canTransitionForward('PENDING', 'SENT')).toBe(true)
    expect(canTransitionForward('PENDING', 'FAILED')).toBe(true)
    expect(canTransitionForward('FAILED', 'PENDING')).toBe(true)
    expect(canTransitionForward('FAILED', 'DEAD')).toBe(true)
    expect(canTransitionForward('DEAD', 'PENDING')).toBe(true) // manual redrive
  })

  it('allows idempotent self-transitions for non-terminal states', () => {
    expect(canTransitionForward('PENDING', 'PENDING')).toBe(true)
    expect(canTransitionForward('FAILED', 'FAILED')).toBe(true)
  })

  it('rejects transitions out of the terminal SENT state', () => {
    expect(canTransitionForward('SENT', 'PENDING')).toBe(false)
    expect(canTransitionForward('SENT', 'FAILED')).toBe(false)
    expect(canTransitionForward('SENT', 'SENT')).toBe(false)
  })
})

describe('messaging — deriveMessageStatus', () => {
  it('couples the capture status to the forward status', () => {
    expect(deriveMessageStatus('SENT')).toBe('FORWARDED')
    expect(deriveMessageStatus('DEAD')).toBe('FAILED')
    expect(deriveMessageStatus('PENDING')).toBe('CAPTURED')
    expect(deriveMessageStatus('FAILED')).toBe('CAPTURED')
  })
})

// ---------------------------------------------------------------------------
// Webhook validation handshake
// ---------------------------------------------------------------------------

describe('messaging — isWebhookValidationHandshake', () => {
  it('returns the token when the Validation-Token header is present (any case)', () => {
    expect(isWebhookValidationHandshake({ 'validation-token': 'abc' })).toBe('abc')
    expect(isWebhookValidationHandshake({ 'Validation-Token': 'XYZ' })).toBe('XYZ')
  })

  it('returns undefined for a normal event delivery', () => {
    expect(isWebhookValidationHandshake({ 'content-type': 'application/json' })).toBeUndefined()
    expect(isWebhookValidationHandshake({})).toBeUndefined()
  })

  it('ignores an empty token value', () => {
    expect(isWebhookValidationHandshake({ 'validation-token': '' })).toBeUndefined()
  })

  it('exposes the canonical header name lowercased', () => {
    expect(VALIDATION_TOKEN_HEADER).toBe('validation-token')
  })
})

// ---------------------------------------------------------------------------
// Status enum sanity
// ---------------------------------------------------------------------------

describe('messaging — status enums', () => {
  it('expose the full status sets', () => {
    expect(MESSAGE_STATUSES).toEqual(['CAPTURED', 'FORWARDED', 'FAILED'])
    expect(FORWARD_STATUSES).toEqual(['PENDING', 'SENT', 'FAILED', 'DEAD'])
  })
})
