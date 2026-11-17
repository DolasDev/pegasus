// ---------------------------------------------------------------------------
// Unit tests for the push triggers — the seam that turns a domain change into
// an outbox row. The Prisma client is a hand-rolled fake so the real
// enqueuePush repository code runs (only the DB call itself is stubbed).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import {
  enqueueChatMessagePush,
  enqueueCrewAssignmentPush,
  enqueueTripAssignmentPush,
} from './push-triggers'

type FakeTx = {
  tenantUser: { findFirst: ReturnType<typeof vi.fn> }
  crewMember: { findFirst: ReturnType<typeof vi.fn> }
  notificationPreference: { findFirst: ReturnType<typeof vi.fn> }
  notification: { upsert: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> }
  pushNotificationOutbox: { upsert: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> }
}

function fakeTx(
  user: { id: string } | null,
  opts: { channel?: string; crewLogin?: string | null } = {},
): FakeTx {
  return {
    tenantUser: { findFirst: vi.fn().mockResolvedValue(user) },
    crewMember: {
      findFirst: vi
        .fn()
        .mockResolvedValue(opts.crewLogin === undefined ? null : { tenantUserId: opts.crewLogin }),
    },
    notificationPreference: {
      findFirst: vi.fn().mockResolvedValue(opts.channel ? { channel: opts.channel } : null),
    },
    notification: {
      upsert: vi.fn().mockResolvedValue({ id: 'notif-1' }),
      create: vi.fn().mockResolvedValue({ id: 'notif-1' }),
    },
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

describe('trip.assigned through notify()', () => {
  it('also writes one Activity row, deduped like the push', async () => {
    const tx = fakeTx({ id: 'user-7' })
    await enqueueTripAssignmentPush(asTx(tx), 'tenant-1', { tripId: 4242, longhaulDriverId: 99 })
    const args = tx.notification.upsert.mock.calls[0]?.[0]
    expect(args.where).toEqual({
      tenantId_dedupeKey: { tenantId: 'tenant-1', dedupeKey: 'trip.assigned:4242:99' },
    })
    expect(args.create).toMatchObject({
      tenantId: 'tenant-1',
      recipientUserId: 'user-7',
      type: 'trip.assigned',
      entityType: 'trip',
      entityId: '4242',
      data: { type: 'trip.assigned', tripId: 4242 },
    })
    // A re-save never resets seen / read.
    expect(args.update).toEqual({})
  })

  it('keeps the push payload exactly as phones already route on it', async () => {
    const tx = fakeTx({ id: 'user-7' })
    await enqueueTripAssignmentPush(asTx(tx), 'tenant-1', { tripId: 4242, longhaulDriverId: 99 })
    expect(tx.pushNotificationOutbox.upsert.mock.calls[0]?.[0]?.create.payload).toEqual({
      title: 'New trip assigned',
      body: 'You have been assigned to a trip. Tap to view the details.',
      data: { type: 'trip.assigned', tripId: 4242 },
    })
  })

  it("follows the user's channel: feed writes no push, off writes nothing", async () => {
    const feed = fakeTx({ id: 'user-7' }, { channel: 'feed' })
    await enqueueTripAssignmentPush(asTx(feed), 'tenant-1', { tripId: 1, longhaulDriverId: 5 })
    expect(feed.notification.upsert).toHaveBeenCalled()
    expect(feed.pushNotificationOutbox.upsert).not.toHaveBeenCalled()

    const off = fakeTx({ id: 'user-7' }, { channel: 'off' })
    await enqueueTripAssignmentPush(asTx(off), 'tenant-1', { tripId: 1, longhaulDriverId: 5 })
    expect(off.notification.upsert).not.toHaveBeenCalled()
    expect(off.pushNotificationOutbox.upsert).not.toHaveBeenCalled()
  })
})

describe('move.assigned through notify()', () => {
  it('pushes to a crew member with no login, with no Activity row', async () => {
    const tx = fakeTx(null, { crewLogin: null })
    await enqueueCrewAssignmentPush(asTx(tx), 'tenant-1', { moveId: 'm1', crewMemberId: 'c1' })
    expect(tx.notification.upsert).not.toHaveBeenCalled()
    expect(tx.pushNotificationOutbox.upsert.mock.calls[0]?.[0]?.create).toMatchObject({
      crewMemberId: 'c1',
      payload: { data: { type: 'move.assigned', moveId: 'm1' } },
    })
  })

  it("writes the linked login's Activity row, still pushing to the crew target", async () => {
    const tx = fakeTx(null, { crewLogin: 'user-9' })
    await enqueueCrewAssignmentPush(asTx(tx), 'tenant-1', { moveId: 'm1', crewMemberId: 'c1' })
    expect(tx.crewMember.findFirst.mock.calls[0]?.[0]?.where).toEqual({
      id: 'c1',
      tenantId: 'tenant-1',
    })
    expect(tx.notification.upsert.mock.calls[0]?.[0]?.create).toMatchObject({
      recipientUserId: 'user-9',
      type: 'move.assigned',
    })
    expect(tx.pushNotificationOutbox.upsert.mock.calls[0]?.[0]?.create.crewMemberId).toBe('c1')
  })
})

describe('chat messages', () => {
  const base = {
    messageId: 'msg-1',
    orderNum: '4242',
    authorName: 'Sam',
    authorUserId: 'author-1',
    recipientUserId: 'user-7',
  }

  it('posts a mention to Activity (grouped by order) and pushes it', async () => {
    const tx = fakeTx(null)
    const pushId = await enqueueChatMessagePush(asTx(tx), 'tenant-1', { ...base, mentioned: true })
    expect(pushId).toBe('outbox-1')
    expect(tx.notification.upsert.mock.calls[0]?.[0]?.create).toMatchObject({
      type: 'chat.mention',
      actorUserId: 'author-1',
      entityType: 'order',
      entityId: '4242',
      groupKey: 'order:4242',
      data: { type: 'chat.message', orderNum: '4242', messageId: 'msg-1' },
    })
  })

  it('keeps a plain message push-only', async () => {
    const tx = fakeTx(null)
    const pushId = await enqueueChatMessagePush(asTx(tx), 'tenant-1', { ...base, mentioned: false })
    expect(pushId).toBe('outbox-1')
    expect(tx.notification.upsert).not.toHaveBeenCalled()
    expect(tx.notificationPreference.findFirst).not.toHaveBeenCalled()
    expect(tx.pushNotificationOutbox.upsert.mock.calls[0]?.[0]?.where).toEqual({
      tenantId_dedupeKey: { tenantId: 'tenant-1', dedupeKey: 'chat.message:msg-1:user-7' },
    })
  })

  it('returns null when a mention is turned down to the feed', async () => {
    const tx = fakeTx(null, { channel: 'feed' })
    expect(
      await enqueueChatMessagePush(asTx(tx), 'tenant-1', { ...base, mentioned: true }),
    ).toBeNull()
    expect(tx.notification.upsert).toHaveBeenCalled()
  })
})
