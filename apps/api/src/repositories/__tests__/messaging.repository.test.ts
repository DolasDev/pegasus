/**
 * Integration tests for the messaging repository (RingCentral SMS capture).
 *
 * Require a live PostgreSQL database; skipped automatically when DATABASE_URL
 * is unset, so they never block CI runs without a provisioned database.
 *
 * To run locally:
 *   DATABASE_URL=postgresql://pegasus:pegasus@localhost:5432/pegasus npm test
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { db } from '../../db'
import {
  upsertConnection,
  findConnectionById,
  listActiveConnections,
  markTokenRefreshed,
  markTokenExpired,
  upsertSubscription,
  findSubscriptionByRcId,
  listSubscriptionsToRenew,
  updateSubscription,
  getSyncCursor,
  saveSyncCursor,
  recordWebhookEvent,
  markWebhookEventProcessed,
  captureMessage,
  listPendingForwards,
  markForwardSent,
  markForwardFailed,
  parkForward,
  purgeForwardedBodies,
  hardDeleteForwarded,
} from '../messaging.repository'
import { toPhoneNumber, type NormalizedMessage } from '@pegasus/domain'

const hasDb = Boolean(process.env['DATABASE_URL'])

const SLUG = 'test-messaging-repo'
let tenantId: string

const normalized = (overrides: Partial<NormalizedMessage> = {}): NormalizedMessage => ({
  source: 'THREAD_STORE',
  externalId: `ext-${Math.round(performance.now() * 1000)}-${overrides.externalId ?? ''}`,
  direction: 'INBOUND',
  fromNumber: toPhoneNumber('+19085760908'),
  toNumber: toPhoneNumber('+12015550123'),
  body: 'hello from the shared inbox',
  rcCreationTime: new Date('2026-06-02T10:00:00.000Z'),
  ...overrides,
})

afterAll(async () => {
  if (hasDb) {
    // FK cascade from tenant removes connections/subscriptions/cursors/messages/outbox/events.
    await db.tenant.deleteMany({ where: { slug: SLUG } })
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('messaging.repository (integration)', () => {
  beforeAll(async () => {
    const tenant = await db.tenant.upsert({
      where: { slug: SLUG },
      create: { name: 'Messaging Repo Test', slug: SLUG },
      update: {},
    })
    tenantId = tenant.id
  })

  // -------------------------------------------------------------------------
  // Connections
  // -------------------------------------------------------------------------

  describe('connections', () => {
    it('upsert is idempotent on (tenantId, account, extension) and token lifecycle works', async () => {
      const a = await upsertConnection(db, tenantId, {
        rcAccountId: 'acct-1',
        rcExtensionId: 'ext-101',
        ownerNumber: '+19085760908',
        scopes: ['SMS', 'Subscriptions'],
      })
      const b = await upsertConnection(db, tenantId, {
        rcAccountId: 'acct-1',
        rcExtensionId: 'ext-101',
        ownerNumber: '+19085760000',
      })
      expect(b.id).toBe(a.id) // same row
      expect(b.ownerNumber).toBe('+19085760000') // updated

      const found = await findConnectionById(db, a.id)
      expect(found?.tokenStatus).toBe('ACTIVE')

      await markTokenRefreshed(db, a.id, new Date(), 'arn:secret:rc/conn')
      const refreshed = await findConnectionById(db, a.id)
      expect(refreshed?.tokenSecretArn).toBe('arn:secret:rc/conn')
      expect(refreshed?.lastRefreshedAt).not.toBeNull()

      const active = await listActiveConnections(db)
      expect(active.map((c) => c.id)).toContain(a.id)

      await markTokenExpired(db, a.id)
      const expired = await findConnectionById(db, a.id)
      expect(expired?.tokenStatus).toBe('EXPIRED')
      expect(expired?.health).toBe('UNHEALTHY')
      // Restore ACTIVE for downstream tests that rely on listActiveConnections.
      await markTokenRefreshed(db, a.id, new Date())
    })
  })

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  describe('subscriptions', () => {
    it('upsert, resolve by RC id, list-to-renew, and update', async () => {
      const conn = await upsertConnection(db, tenantId, {
        rcAccountId: 'acct-sub',
        rcExtensionId: 'ext-sub',
        ownerNumber: '+19085761111',
      })
      const past = new Date(Date.now() - 60_000)
      const sub = await upsertSubscription(db, tenantId, {
        connectionId: conn.id,
        subscriptionId: 'rc-sub-1',
        eventFilters: ['/restapi/v1.0/account/~/message-threads/entries/sync'],
        deliveryAddress: 'https://hook.example/api/v1/integrations/ringcentral/webhook',
        verificationToken: 'vtok-123',
        expiresAt: past,
      })
      expect(sub.status).toBe('ACTIVE')

      const resolved = await findSubscriptionByRcId(db, 'rc-sub-1')
      expect(resolved?.tenantId).toBe(tenantId)
      expect(resolved?.connectionId).toBe(conn.id)
      expect(resolved?.verificationToken).toBe('vtok-123')

      const due = await listSubscriptionsToRenew(db, new Date())
      expect(due.map((s) => s.id)).toContain(sub.id) // expired in the past → due

      await updateSubscription(db, sub.id, { status: 'EXPIRING', failureCount: 2 })
      const updated = await findSubscriptionByRcId(db, 'rc-sub-1')
      expect(updated?.status).toBe('EXPIRING')
      expect(updated?.failureCount).toBe(2)

      // Re-upsert resets failureCount and status to ACTIVE.
      const future = new Date(Date.now() + 3_600_000)
      await upsertSubscription(db, tenantId, {
        connectionId: conn.id,
        subscriptionId: 'rc-sub-1',
        eventFilters: ['/restapi/v1.0/account/~/message-threads/entries/sync'],
        deliveryAddress: 'https://hook.example/api/v1/integrations/ringcentral/webhook',
        verificationToken: 'vtok-456',
        expiresAt: future,
      })
      const reupserted = await findSubscriptionByRcId(db, 'rc-sub-1')
      expect(reupserted?.failureCount).toBe(0)
      expect(reupserted?.status).toBe('ACTIVE')
      expect(reupserted?.verificationToken).toBe('vtok-456')
    })
  })

  // -------------------------------------------------------------------------
  // Sync cursor
  // -------------------------------------------------------------------------

  describe('sync cursor', () => {
    it('save then get round-trips per (tenant, connection, store)', async () => {
      const conn = await upsertConnection(db, tenantId, {
        rcAccountId: 'acct-cur',
        rcExtensionId: 'ext-cur',
        ownerNumber: '+19085762222',
      })
      expect(await getSyncCursor(db, tenantId, conn.id, 'THREAD')).toBeNull()

      await saveSyncCursor(db, tenantId, conn.id, 'THREAD', 'token-A')
      await saveSyncCursor(db, tenantId, conn.id, 'V1', 'token-B')

      const thread = await getSyncCursor(db, tenantId, conn.id, 'THREAD')
      expect(thread?.syncToken).toBe('token-A')
      expect(thread?.lastSyncAt).not.toBeNull()

      await saveSyncCursor(db, tenantId, conn.id, 'THREAD', 'token-A2')
      const advanced = await getSyncCursor(db, tenantId, conn.id, 'THREAD')
      expect(advanced?.syncToken).toBe('token-A2')

      const v1 = await getSyncCursor(db, tenantId, conn.id, 'V1')
      expect(v1?.syncToken).toBe('token-B') // independent store
    })
  })

  // -------------------------------------------------------------------------
  // Webhook events
  // -------------------------------------------------------------------------

  describe('webhook events', () => {
    it('records a raw event and marks it processed', async () => {
      const id = await recordWebhookEvent(db, tenantId, {
        subscriptionId: 'rc-sub-1',
        rawPayload: { uuid: 'evt-1', body: { lastModifiedTime: '2026-06-02T10:00:00Z' } },
        headers: { 'verification-token': 'vtok' },
      })
      expect(id).toBeTruthy()
      const processed = await markWebhookEventProcessed(db, id)
      expect(processed.status).toBe('PROCESSED')
      expect(processed.processedAt).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // captureMessage idempotency + outbox lifecycle
  // -------------------------------------------------------------------------

  describe('captureMessage + outbox', () => {
    it('is idempotent on (tenantId, source, externalId) and enqueues one outbox row', async () => {
      const msg = normalized({ externalId: 'dup', body: 'original body' })
      const first = await captureMessage(db, tenantId, msg)
      const second = await captureMessage(db, tenantId, {
        ...msg,
        body: 'edited body',
        rcLastModifiedTime: new Date('2026-06-02T11:00:00.000Z'),
      })
      expect(second.id).toBe(first.id) // same row — converged on dedupe key
      // SMS text is immutable per message id — re-capture must NOT rewrite body
      // (prevents resurrecting a purged PII body), but refreshes metadata.
      expect(second.body).toBe('original body')
      expect(second.rcLastModifiedTime).toEqual(new Date('2026-06-02T11:00:00.000Z'))

      const outboxRows = await db.messageForwardOutbox.findMany({
        where: { messageId: first.id },
      })
      expect(outboxRows).toHaveLength(1) // exactly one
      expect(outboxRows[0]!.status).toBe('PENDING')
    })

    it('does not resurrect a purged body on re-capture of a forwarded message', async () => {
      const msg = normalized({ externalId: 'purged' })
      const m = await captureMessage(db, tenantId, msg)
      // Simulate forward + 72h purge.
      const obx = await db.messageForwardOutbox.findUnique({ where: { messageId: m.id } })
      await markForwardSent(db, obx!.id, m.id, new Date())
      await db.message.update({
        where: { id: m.id },
        data: { body: null, bodyPurgedAt: new Date() },
      })
      // Safety-net sync re-captures the same message within the 30-day window.
      await captureMessage(db, tenantId, msg)
      const after = await db.message.findUnique({ where: { id: m.id } })
      expect(after?.body).toBeNull() // PII stays purged
      expect(after?.forwardStatus).toBe('SENT') // not re-queued
    })

    it('thread and v1 stores with the same external id do not collide', async () => {
      const ext = 'shared-id'
      const t = await captureMessage(
        db,
        tenantId,
        normalized({ source: 'THREAD_STORE', externalId: ext }),
      )
      const v = await captureMessage(
        db,
        tenantId,
        normalized({ source: 'V1_STORE', externalId: ext, direction: 'OUTBOUND' }),
      )
      expect(t.id).not.toBe(v.id)
    })

    it('drains pending forwards, marks SENT (with purgeAfter), and FAILED with backoff', async () => {
      const captured = await captureMessage(db, tenantId, normalized({ externalId: 'fwd' }))
      const pending = await listPendingForwards(db, 50)
      const row = pending.find((p) => p.messageId === captured.id)
      expect(row).toBeDefined()
      expect(row!.message.body).toBeTruthy() // message joined

      // Fail once with a future backoff.
      const backoff = new Date(Date.now() + 30_000)
      await markForwardFailed(db, row!.id, captured.id, {
        nextStatus: 'FAILED',
        error: 'on-prem unreachable',
        nextAttemptAt: backoff,
      })
      const afterFail = await db.message.findUnique({ where: { id: captured.id } })
      expect(afterFail?.forwardStatus).toBe('FAILED')
      // Not due yet (nextAttemptAt 30s in the future), so the backoff hides it.
      const stillPending = await listPendingForwards(db, 50)
      expect(stillPending.find((p) => p.messageId === captured.id)).toBeUndefined()

      // Once the backoff elapses a FAILED row is re-drained (retry), not stuck.
      const dueAgain = await listPendingForwards(db, 50, new Date(Date.now() + 60_000))
      expect(dueAgain.find((p) => p.messageId === captured.id)).toBeDefined()

      // Mark sent.
      const purgeAfter = new Date(Date.now() + 72 * 3_600_000)
      const obx = await db.messageForwardOutbox.findUnique({ where: { messageId: captured.id } })
      await markForwardSent(db, obx!.id, captured.id, purgeAfter)
      const sent = await db.message.findUnique({ where: { id: captured.id } })
      expect(sent?.forwardStatus).toBe('SENT')
      expect(sent?.status).toBe('FORWARDED')
      expect(sent?.purgeAfter).not.toBeNull()
    })

    it('parks a forward (transient on-prem outage) without consuming an attempt', async () => {
      const captured = await captureMessage(db, tenantId, normalized({ externalId: 'park' }))
      const obx = await db.messageForwardOutbox.findUnique({ where: { messageId: captured.id } })
      expect(obx?.attempts).toBe(0)

      const later = new Date(Date.now() + 5 * 60_000)
      await parkForward(db, obx!.id, later, 'on-prem unreachable')

      const parked = await db.messageForwardOutbox.findUnique({ where: { messageId: captured.id } })
      // Stays PENDING + attempts untouched, so a long outage never dead-letters.
      expect(parked?.status).toBe('PENDING')
      expect(parked?.attempts).toBe(0)
      expect(parked?.lastError).toBe('on-prem unreachable')
      // The message stays merely CAPTURED — the forward never advanced.
      const msg = await db.message.findUnique({ where: { id: captured.id } })
      expect(msg?.forwardStatus).toBe('PENDING')
      expect(msg?.status).toBe('CAPTURED')
    })
  })

  describe('buffer-purge', () => {
    it('purges only forwarded bodies past their window, idempotently', async () => {
      // SENT + purge window elapsed → eligible.
      const due = await captureMessage(db, tenantId, normalized({ externalId: 'purge-due' }))
      const dueObx = await db.messageForwardOutbox.findUnique({ where: { messageId: due.id } })
      await markForwardSent(db, dueObx!.id, due.id, new Date(Date.now() - 1_000))

      // SENT but window still in the future → not yet eligible.
      const future = await captureMessage(db, tenantId, normalized({ externalId: 'purge-future' }))
      const futureObx = await db.messageForwardOutbox.findUnique({
        where: { messageId: future.id },
      })
      await markForwardSent(db, futureObx!.id, future.id, new Date(Date.now() + 72 * 3_600_000))

      // Never forwarded → never purged.
      const pending = await captureMessage(
        db,
        tenantId,
        normalized({ externalId: 'purge-pending' }),
      )

      const purged = await purgeForwardedBodies(db)
      expect(purged).toBeGreaterThanOrEqual(1)

      const dueRow = await db.message.findUnique({ where: { id: due.id } })
      expect(dueRow?.body).toBeNull()
      expect(dueRow?.bodyPurgedAt).not.toBeNull()

      const futureRow = await db.message.findUnique({ where: { id: future.id } })
      expect(futureRow?.body).toBeTruthy()
      expect(futureRow?.bodyPurgedAt).toBeNull()

      const pendingRow = await db.message.findUnique({ where: { id: pending.id } })
      expect(pendingRow?.body).toBeTruthy()

      // Idempotent: a second sweep does not re-stamp an already-purged row (the
      // `bodyPurgedAt: null` guard excludes it), so its purge timestamp is stable.
      const firstPurgedAt = dueRow?.bodyPurgedAt?.getTime()
      await purgeForwardedBodies(db)
      const stillDue = await db.message.findUnique({ where: { id: due.id } })
      expect(stillDue?.body).toBeNull()
      expect(stillDue?.bodyPurgedAt?.getTime()).toBe(firstPurgedAt)
    })

    it('hard-deletes SENT tombstones older than the cutoff and cascades the outbox', async () => {
      const old = await captureMessage(db, tenantId, normalized({ externalId: 'del-old' }))
      const oldObx = await db.messageForwardOutbox.findUnique({ where: { messageId: old.id } })
      await markForwardSent(db, oldObx!.id, old.id, new Date(Date.now() - 1_000))
      // Backdate capture beyond the retention horizon.
      await db.message.update({
        where: { id: old.id },
        data: { capturedAt: new Date('2026-01-01T00:00:00.000Z') },
      })

      // Recent SENT row → retained.
      const recent = await captureMessage(db, tenantId, normalized({ externalId: 'del-recent' }))
      const recentObx = await db.messageForwardOutbox.findUnique({
        where: { messageId: recent.id },
      })
      await markForwardSent(db, recentObx!.id, recent.id, new Date(Date.now() - 1_000))

      // Old but never forwarded → retained (not yet durable on-prem).
      const oldPending = await captureMessage(
        db,
        tenantId,
        normalized({ externalId: 'del-pending' }),
      )
      await db.message.update({
        where: { id: oldPending.id },
        data: { capturedAt: new Date('2026-01-01T00:00:00.000Z') },
      })

      const cutoff = new Date(Date.now() - 30 * 24 * 3_600_000)
      const deleted = await hardDeleteForwarded(db, cutoff)
      expect(deleted).toBe(1)

      expect(await db.message.findUnique({ where: { id: old.id } })).toBeNull()
      // Cascade dropped the outbox row too.
      expect(await db.messageForwardOutbox.findUnique({ where: { messageId: old.id } })).toBeNull()
      expect(await db.message.findUnique({ where: { id: recent.id } })).not.toBeNull()
      expect(await db.message.findUnique({ where: { id: oldPending.id } })).not.toBeNull()
    })
  })
})
