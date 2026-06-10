// ---------------------------------------------------------------------------
// Unit tests for the domain-event outbox helper (lib/domain-events.ts)
//
// emitDomainEvent is intentionally dumb — it appends one row via whatever
// Prisma client it is handed. These tests assert the row shape and that the
// helper writes through the GIVEN client (transaction atomicity is the
// caller's responsibility).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import {
  emitDomainEvent,
  DOMAIN_EVENT_TYPES,
  type DomainEventType,
} from '../domain-events'

function fakeTx() {
  const create = vi.fn().mockResolvedValue({ id: 'evt-1' })
  const tx = { domainEvent: { create } } as unknown as Prisma.TransactionClient
  return { tx, create }
}

describe('emitDomainEvent', () => {
  it('creates a DomainEvent row with tenantId, eventType, and payload', async () => {
    const { tx, create } = fakeTx()
    await emitDomainEvent(tx, {
      tenantId: 'tenant-1',
      eventType: 'quote.accepted',
      payload: { quoteId: 'quote-1', moveId: 'move-1' },
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        eventType: 'quote.accepted',
        payload: { quoteId: 'quote-1', moveId: 'move-1' },
      },
    })
  })

  it('writes through the client it is given (no hidden transaction)', async () => {
    const { tx, create } = fakeTx()
    await emitDomainEvent(tx, {
      tenantId: 'tenant-2',
      eventType: 'customer.created',
      payload: { customerId: 'cust-1' },
    })
    expect(create.mock.calls[0]?.[0]?.data?.tenantId).toBe('tenant-2')
  })

  it('propagates create failures to the caller (so the tx rolls back)', async () => {
    const { tx, create } = fakeTx()
    create.mockRejectedValueOnce(new Error('insert failed'))
    await expect(
      emitDomainEvent(tx, {
        tenantId: 'tenant-1',
        eventType: 'invoice.paid',
        payload: { invoiceId: 'inv-1' },
      }),
    ).rejects.toThrow('insert failed')
  })

  it('exposes exactly the five launch event types (public contract)', () => {
    const expected: readonly DomainEventType[] = [
      'quote.accepted',
      'move.status_changed',
      'invoice.paid',
      'customer.created',
      'pegasus_event.received',
    ]
    expect([...DOMAIN_EVENT_TYPES]).toEqual([...expected])
  })
})
