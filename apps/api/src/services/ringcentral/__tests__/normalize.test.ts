import { describe, it, expect } from 'vitest'
import { normalizeV1Json, normalizeThreadJson } from '../normalize'
import { type DomainError } from '@pegasus/domain'

describe('normalizeV1Json', () => {
  it('maps a v1 message-store SMS record', () => {
    const m = normalizeV1Json({
      id: 555,
      type: 'SMS',
      direction: 'Outbound',
      creationTime: '2026-05-31T08:00:00.000Z',
      lastModifiedTime: '2026-05-31T08:00:00.000Z',
      subject: 'crew en route',
      from: { phoneNumber: '+19085760908' },
      to: [{ phoneNumber: '+12015550123' }],
    })
    expect(m).toMatchObject({
      source: 'V1_STORE',
      externalId: '555',
      direction: 'OUTBOUND',
      fromNumber: '+19085760908',
      toNumber: '+12015550123',
      body: 'crew en route',
    })
  })

  it('propagates UNSUPPORTED_MESSAGE_TYPE for a non-SMS record', () => {
    try {
      normalizeV1Json({
        id: 1,
        type: 'Fax',
        from: { phoneNumber: '+19085760908' },
        to: [{ phoneNumber: '+12015550123' }],
        creationTime: '2026-05-31T08:00:00.000Z',
      })
      expect.unreachable()
    } catch (e) {
      expect((e as DomainError).code).toBe('UNSUPPORTED_MESSAGE_TYPE')
    }
  })
})

describe('normalizeThreadJson', () => {
  const phones = { from: '+19085760908', to: '+12015550123' }

  it('maps a thread entry using text + resolved phone pair', () => {
    const m = normalizeThreadJson(
      {
        id: 9001,
        type: 'SMS',
        direction: 'Inbound',
        creationTime: '2026-06-02T10:00:00.000Z',
        text: 'hello',
      },
      'thread-42',
      phones,
    )
    expect(m).toMatchObject({
      source: 'THREAD_STORE',
      externalId: '9001',
      threadId: 'thread-42',
      direction: 'INBOUND',
      fromNumber: '+19085760908',
      toNumber: '+12015550123',
      body: 'hello',
    })
  })

  it('propagates INVALID_PHONE_NUMBER when a resolved number is not E.164', () => {
    try {
      normalizeThreadJson({ id: 1, type: 'SMS', creationTime: '2026-06-02T10:00:00.000Z' }, 't', {
        from: '5551234',
        to: '+12015550123',
      })
      expect.unreachable()
    } catch (e) {
      expect((e as DomainError).code).toBe('INVALID_PHONE_NUMBER')
    }
  })
})
