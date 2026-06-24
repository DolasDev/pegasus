// ---------------------------------------------------------------------------
// Unit tests for the pegII integration-event mapper.
//
// Verifies the buffer → DomainEvent path:
//   - a valid event for an ACTIVE tenant writes an inbox row, claims dispatch,
//     and emits a DomainEvent with the derived pegii.* type
//   - an unknown / non-ACTIVE tenant is a poison message (batchItemFailure)
//   - at-least-once re-delivery is idempotent — the conditional dispatch claim
//     (updateMany count 0) suppresses a second DomainEvent
//   - a malformed envelope fails its record without poisoning the batch
//
// `../db` is mocked; no Postgres needed.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

const { mockTenantFindFirst, mockInboxCreate, mockInboxUpdateMany, mockDomainEventCreate, mockTx } =
  vi.hoisted(() => {
    const inboxUpdateMany = vi.fn()
    const domainEventCreate = vi.fn()
    return {
      mockTenantFindFirst: vi.fn(),
      mockInboxCreate: vi.fn(),
      mockInboxUpdateMany: inboxUpdateMany,
      mockDomainEventCreate: domainEventCreate,
      mockTx: {
        shipmentEventInbox: { updateMany: inboxUpdateMany },
        domainEvent: { create: domainEventCreate },
      },
    }
  })

vi.mock('../db', () => ({
  db: {
    tenant: { findFirst: mockTenantFindFirst },
    shipmentEventInbox: { create: mockInboxCreate },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx),
  },
}))

import { handler, deriveEventType } from '../lambda-integration-event-map'

// ── Helpers ──────────────────────────────────────────────────────────────

function ebRecord(
  overrides: { detailType?: string; detail?: Record<string, unknown>; messageId?: string } = {},
) {
  const detail = {
    tenantId: 'tenant-1',
    eventId: 'outbox-guid-1',
    schemaVersion: 1,
    occurredAt: '2026-06-24T12:00:00.000Z',
    payload: { code: 'SHIP-100', driver: 'Pat', status: 'OPEN' },
    ...(overrides.detail ?? {}),
  }
  const body = JSON.stringify({
    'detail-type': overrides.detailType ?? 'Shipment.Opened',
    source: 'pegii.movemanager',
    detail,
  })
  return { messageId: overrides.messageId ?? 'sqs-msg-1', body }
}

function sqsEvent(records: ReturnType<typeof ebRecord>[]) {
  return { Records: records } as unknown as Parameters<typeof handler>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  mockTenantFindFirst.mockResolvedValue({ id: 'tenant-1' })
  mockInboxCreate.mockResolvedValue({})
  mockInboxUpdateMany.mockResolvedValue({ count: 1 })
  mockDomainEventCreate.mockResolvedValue({})
})

// ── Tests ────────────────────────────────────────────────────────────────

describe('deriveEventType', () => {
  it('lowercases the detail-type under the pegii namespace', () => {
    expect(deriveEventType('Shipment.Opened')).toBe('pegii.shipment.opened')
    expect(deriveEventType('Shipment.Closed')).toBe('pegii.shipment.closed')
  })
})

describe('integration-event mapper', () => {
  it('maps a valid event to a tenant-scoped DomainEvent', async () => {
    const res = await handler(sqsEvent([ebRecord()]))
    expect(res.batchItemFailures).toEqual([])

    // Inbox ledger row written keyed on the legacy event id, dispatchedAt unset.
    expect(mockInboxCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        messageId: 'outbox-guid-1',
        aggregateType: 'Shipment',
        aggregateId: 'SHIP-100',
        eventType: 'Shipment.Opened',
        source: 'pegii.movemanager',
      }),
    })
    // DomainEvent emitted with the derived type + tenant.
    expect(mockDomainEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        eventType: 'pegii.shipment.opened',
      }),
    })
  })

  it('dead-letters an event whose tenant is not a known ACTIVE tenant', async () => {
    mockTenantFindFirst.mockResolvedValue(null)
    const res = await handler(sqsEvent([ebRecord()]))
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'sqs-msg-1' }])
    expect(mockDomainEventCreate).not.toHaveBeenCalled()
  })

  it('is idempotent — a re-delivery that loses the dispatch claim emits nothing', async () => {
    // Inbox row already exists (P2002) and dispatch already claimed (count 0).
    mockInboxCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    )
    mockInboxUpdateMany.mockResolvedValue({ count: 0 })

    const res = await handler(sqsEvent([ebRecord()]))
    expect(res.batchItemFailures).toEqual([])
    expect(mockDomainEventCreate).not.toHaveBeenCalled()
  })

  it('fails only the malformed record, not the whole batch', async () => {
    const good = ebRecord({ messageId: 'good' })
    const bad = { messageId: 'bad', body: JSON.stringify({ 'detail-type': 'X' }) } // no detail
    const res = await handler(sqsEvent([bad, good]))
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'bad' }])
    expect(mockDomainEventCreate).toHaveBeenCalledTimes(1)
  })
})
