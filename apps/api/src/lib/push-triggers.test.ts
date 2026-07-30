// ---------------------------------------------------------------------------
// Unit tests for the push triggers — the seam that turns a domain change into
// an outbox row. The Prisma client is a hand-rolled fake so the real
// enqueuePush repository code runs (only the DB call itself is stubbed).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { enqueueTripAssignmentPush } from './push-triggers'

type FakeTx = {
  tenantUser: { findFirst: ReturnType<typeof vi.fn> }
  pushNotificationOutbox: { upsert: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> }
}

function fakeTx(user: { id: string } | null): FakeTx {
  return {
    tenantUser: { findFirst: vi.fn().mockResolvedValue(user) },
    pushNotificationOutbox: {
      upsert: vi.fn().mockResolvedValue({ id: 'outbox-1' }),
      create: vi.fn().mockResolvedValue({ id: 'outbox-1' }),
    },
  }
}

const asTx = (t: FakeTx) => t as unknown as Prisma.TransactionClient

describe('enqueueTripAssignmentPush', () => {
  it('enqueues a trip.assigned push for the user mapped to the longhaul driver', async () => {
    const tx = fakeTx({ id: 'user-7' })

    const enqueued = await enqueueTripAssignmentPush(asTx(tx), 'tenant-1', {
      tripId: 4242,
      longhaulDriverId: 99,
    })

    expect(enqueued).toBe(true)
    expect(tx.tenantUser.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-1', longhaulDriverId: 99 }),
      }),
    )
    const args = tx.pushNotificationOutbox.upsert.mock.calls[0]?.[0]
    expect(args.create).toMatchObject({ tenantId: 'tenant-1', userId: 'user-7' })
    expect(args.create.payload).toMatchObject({
      data: { type: 'trip.assigned', tripId: 4242 },
    })
    expect(args.create.payload.title).toBeTruthy()
    expect(args.create.payload.body).toBeTruthy()
  })

  it('dedupes per (trip, driver) so repeated saves never double-notify', async () => {
    const tx = fakeTx({ id: 'user-7' })

    await enqueueTripAssignmentPush(asTx(tx), 'tenant-1', { tripId: 4242, longhaulDriverId: 99 })

    const args = tx.pushNotificationOutbox.upsert.mock.calls[0]?.[0]
    expect(args.where).toEqual({
      tenantId_dedupeKey: { tenantId: 'tenant-1', dedupeKey: 'trip.assigned:4242:99' },
    })
    // Re-enqueue of the same logical event must never reset delivery state.
    expect(args.update).toEqual({})
  })

  it('is a no-op when no tenant user is mapped to that driver id', async () => {
    const tx = fakeTx(null)

    const enqueued = await enqueueTripAssignmentPush(asTx(tx), 'tenant-1', {
      tripId: 4242,
      longhaulDriverId: 99,
    })

    expect(enqueued).toBe(false)
    expect(tx.pushNotificationOutbox.upsert).not.toHaveBeenCalled()
    expect(tx.pushNotificationOutbox.create).not.toHaveBeenCalled()
  })

  it('excludes deactivated users and service accounts from the mapping lookup', async () => {
    const tx = fakeTx({ id: 'user-7' })

    await enqueueTripAssignmentPush(asTx(tx), 'tenant-1', { tripId: 1, longhaulDriverId: 5 })

    const where = tx.tenantUser.findFirst.mock.calls[0]?.[0]?.where
    expect(where.isServiceAccount).toBe(false)
    expect(where.status).toEqual({ not: 'DEACTIVATED' })
  })
})
