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
  listConnectionsByTenant,
  deleteConnectionForTenant,
  markTokenRefreshed,
  markTokenExpired,
  upsertSubscription,
  findSubscriptionByRcId,
  listSubscriptionsToRenew,
  updateSubscription,
  getSyncCursor,
  saveSyncCursor,
  saveBackfillProgress,
  recordWebhookEvent,
  markWebhookEventProcessed,
  captureMessage,
  purgeReceivedEventBodies,
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
// Extra tenants for the forward-drain eligibility/fairness cases.
const SLUG_NO_ONPREM = 'test-messaging-repo-no-onprem'
const SLUG_EMPTY_ONPREM = 'test-messaging-repo-empty-onprem'
const SLUG_BUSY = 'test-messaging-repo-busy'
const ALL_SLUGS = [SLUG, SLUG_NO_ONPREM, SLUG_EMPTY_ONPREM, SLUG_BUSY]
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
    // domain_events has no tenant cascade (sms.received rows) — clear them first.
    await db.domainEvent.deleteMany({ where: { tenant: { slug: { in: ALL_SLUGS } } } })
    // FK cascade from tenant removes connections/subscriptions/cursors/messages/outbox/events.
    await db.tenant.deleteMany({ where: { slug: { in: ALL_SLUGS } } })
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('messaging.repository (integration)', () => {
  beforeAll(async () => {
    const tenant = await db.tenant.upsert({
      where: { slug: SLUG },
      // The forward drain only returns rows for tenants with an on-prem target.
      create: { name: 'Messaging Repo Test', slug: SLUG, mssqlConnectionString: 'Server=onprem;' },
      update: { mssqlConnectionString: 'Server=onprem;' },
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

    it('listConnectionsByTenant returns only the tenant own connections', async () => {
      // A second, isolated tenant whose connection must never leak into ours.
      const otherTenant = await db.tenant.upsert({
        where: { slug: `${SLUG}-other` },
        create: { name: 'Messaging Repo Test Other', slug: `${SLUG}-other` },
        update: {},
      })
      try {
        const mine = await upsertConnection(db, tenantId, {
          rcAccountId: 'acct-list',
          rcExtensionId: 'ext-list',
          ownerNumber: '+19085763333',
        })
        const foreign = await upsertConnection(db, otherTenant.id, {
          rcAccountId: 'acct-foreign',
          rcExtensionId: 'ext-foreign',
          ownerNumber: '+19085764444',
        })

        const listed = await listConnectionsByTenant(db, tenantId)
        const ids = listed.map((c) => c.id)
        expect(ids).toContain(mine.id)
        expect(ids).not.toContain(foreign.id)
        expect(listed.every((c) => c.tenantId === tenantId)).toBe(true)
      } finally {
        await db.tenant.deleteMany({ where: { slug: `${SLUG}-other` } })
      }
    })

    it('deleteConnectionForTenant removes only the owned row, cascades, and is tenant-safe', async () => {
      const otherTenant = await db.tenant.upsert({
        where: { slug: `${SLUG}-del` },
        create: { name: 'Messaging Repo Test Del', slug: `${SLUG}-del` },
        update: {},
      })
      try {
        const conn = await upsertConnection(db, tenantId, {
          rcAccountId: 'acct-del',
          rcExtensionId: 'ext-del',
          ownerNumber: '+19085765555',
        })
        const foreign = await upsertConnection(db, otherTenant.id, {
          rcAccountId: 'acct-del-foreign',
          rcExtensionId: 'ext-del-foreign',
          ownerNumber: '+19085766666',
        })

        // Give the owned connection a subscription + sync cursor that should cascade.
        const sub = await upsertSubscription(db, tenantId, {
          connectionId: conn.id,
          subscriptionId: 'rc-sub-del',
          eventFilters: ['/restapi/v1.0/account/~/message-threads/entries/sync'],
          deliveryAddress: 'https://hook.example/api/v1/integrations/ringcentral/webhook',
          verificationToken: 'vtok-del',
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        await saveSyncCursor(db, tenantId, conn.id, 'THREAD', 'token-del')

        // Foreign id under our tenant → no match → count 0, foreign row untouched.
        expect(await deleteConnectionForTenant(db, tenantId, foreign.id)).toBe(0)
        expect(await findConnectionById(db, foreign.id)).not.toBeNull()

        // Owned id → deleted, returns 1.
        expect(await deleteConnectionForTenant(db, tenantId, conn.id)).toBe(1)
        expect(await findConnectionById(db, conn.id)).toBeNull()

        // Cascade dropped the subscription + sync cursor.
        expect(await findSubscriptionByRcId(db, 'rc-sub-del')).toBeNull()
        expect(await getSyncCursor(db, tenantId, conn.id, 'THREAD')).toBeNull()
        // (sub captured for clarity; its row is gone via cascade)
        expect(sub.id).toBeTruthy()

        // Idempotent: a repeat delete of the now-missing row returns 0.
        expect(await deleteConnectionForTenant(db, tenantId, conn.id)).toBe(0)
      } finally {
        await db.tenant.deleteMany({ where: { slug: `${SLUG}-del` } })
      }
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
    it('records and clears v1 backfill progress without touching the sync token', async () => {
      const conn = await upsertConnection(db, tenantId, {
        rcAccountId: 'acct-bf',
        rcExtensionId: 'ext-bf',
        ownerNumber: '+19085760908',
      })
      await saveSyncCursor(db, tenantId, conn.id, 'V1', 'tok-bf')
      const from = new Date('2026-06-30T12:00:00.000Z')
      const before = new Date('2026-09-22T00:00:00.000Z')

      await saveBackfillProgress(db, tenantId, conn.id, 'V1', { from, before })
      const owed = await getSyncCursor(db, tenantId, conn.id, 'V1')
      expect(owed?.backfillFrom).toEqual(from)
      expect(owed?.backfillBefore).toEqual(before)
      expect(owed?.syncToken).toBe('tok-bf')

      await saveBackfillProgress(db, tenantId, conn.id, 'V1', null)
      const done = await getSyncCursor(db, tenantId, conn.id, 'V1')
      expect(done?.backfillFrom).toBeNull()
      expect(done?.backfillBefore).toBeNull()
      expect(done?.syncToken).toBe('tok-bf')
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

    describe('sms.received event', () => {
      const EMIT = { emitReceivedEvent: true }
      const eventsFor = (messageId: string) =>
        db.domainEvent.findMany({
          where: {
            tenantId,
            eventType: 'sms.received',
            payload: { path: ['messageId'], equals: messageId },
          },
        })

      it('emits exactly once for a first-time inbound capture, with a parse-ready payload', async () => {
        const msg = normalized({ externalId: 'evt-in', body: 'YES confirm Tuesday' })
        const m = await captureMessage(db, tenantId, msg, undefined, EMIT)
        await captureMessage(db, tenantId, msg, undefined, EMIT) // webhook + sync converge

        const events = await eventsFor(m.id)
        expect(events).toHaveLength(1)
        expect(events[0]!.payload).toMatchObject({
          messageId: m.id,
          source: 'THREAD_STORE',
          externalId: msg.externalId,
          fromNumber: '+19085760908',
          toNumber: '+12015550123',
          body: 'YES confirm Tuesday',
          rcCreationTime: '2026-06-02T10:00:00.000Z',
        })
      })

      it('emits once when two captures of the same message race', async () => {
        const msg = normalized({ externalId: 'evt-race' })
        const results = await Promise.allSettled([
          captureMessage(db, tenantId, msg, undefined, EMIT),
          captureMessage(db, tenantId, msg, undefined, EMIT),
        ])
        const ok = results.find(
          (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof captureMessage>>> =>
            r.status === 'fulfilled',
        )!
        expect(await eventsFor(ok.value.id)).toHaveLength(1)
      })

      it('never emits for an outbound message (a workflow reply must not re-trigger it)', async () => {
        const m = await captureMessage(
          db,
          tenantId,
          normalized({ externalId: 'evt-out', direction: 'OUTBOUND' }),
          undefined,
          EMIT,
        )
        expect(await eventsFor(m.id)).toHaveLength(0)
      })

      it('does not emit unless asked (full sync / backfill)', async () => {
        const m = await captureMessage(db, tenantId, normalized({ externalId: 'evt-backfill' }))
        expect(await eventsFor(m.id)).toHaveLength(0)
      })

      it('purges the text from dispatched events past the cutoff, keeping the rest', async () => {
        const cutoff = new Date('2026-06-10T00:00:00.000Z')
        const old = await captureMessage(
          db,
          tenantId,
          normalized({ externalId: 'p-old' }),
          undefined,
          EMIT,
        )
        const pend = await captureMessage(
          db,
          tenantId,
          normalized({ externalId: 'p-pend' }),
          undefined,
          EMIT,
        )
        const fresh = await captureMessage(
          db,
          tenantId,
          normalized({ externalId: 'p-new' }),
          undefined,
          EMIT,
        )
        const [eOld] = await eventsFor(old.id)
        const [ePend] = await eventsFor(pend.id)
        const [eFresh] = await eventsFor(fresh.id)
        const before = new Date(cutoff.getTime() - 1000)
        await db.domainEvent.update({
          where: { id: eOld!.id },
          data: { occurredAt: before, dispatchedAt: before },
        })
        await db.domainEvent.update({ where: { id: ePend!.id }, data: { occurredAt: before } }) // not dispatched
        await db.domainEvent.update({
          where: { id: eFresh!.id },
          data: { dispatchedAt: new Date() },
        }) // after cutoff

        // A custom event derived from the old sms.received (dispatcher copies the
        // payload), and an unrelated derived event that must be left alone.
        const derived = await db.domainEvent.create({
          data: {
            tenantId,
            eventType: 'reply.yes',
            payload: { ...(eOld!.payload as object), _derivedFrom: eOld!.id },
            occurredAt: before,
            dispatchedAt: before,
          },
        })
        const other = await db.domainEvent.create({
          data: {
            tenantId,
            eventType: 'quote.big',
            payload: { body: 'not an sms', _derivedFrom: '00000000-0000-0000-0000-000000000000' },
            occurredAt: before,
            dispatchedAt: before,
          },
        })

        // batchSize 1 exercises keyset paging past the skipped unrelated row.
        expect(await purgeReceivedEventBodies(db, cutoff, 1)).toBe(2)
        expect(await purgeReceivedEventBodies(db, cutoff)).toBe(0) // idempotent

        const [aOld] = await eventsFor(old.id)
        expect(aOld!.payload).toMatchObject({
          messageId: old.id,
          body: null,
          fromNumber: '+19085760908',
        })
        expect((await eventsFor(pend.id))[0]!.payload).toMatchObject({
          body: 'hello from the shared inbox',
        })
        expect((await eventsFor(fresh.id))[0]!.payload).toMatchObject({
          body: 'hello from the shared inbox',
        })
        const dAfter = await db.domainEvent.findUnique({ where: { id: derived.id } })
        expect(dAfter!.payload).toMatchObject({ body: null, _derivedFrom: eOld!.id })
        const oAfter = await db.domainEvent.findUnique({ where: { id: other.id } })
        expect(oAfter!.payload).toMatchObject({ body: 'not an sms' })
      })

      it('does not emit for the same text captured from the other store', async () => {
        const at = new Date('2026-06-03T09:00:00.000Z')
        const body = 'cross-store twin'
        const t = await captureMessage(
          db,
          tenantId,
          normalized({ source: 'THREAD_STORE', externalId: 'twin-t', body, rcCreationTime: at }),
          undefined,
          EMIT,
        )
        const v = await captureMessage(
          db,
          tenantId,
          normalized({
            source: 'V1_STORE',
            externalId: 'twin-v',
            body,
            rcCreationTime: new Date(at.getTime() + 2_000),
          }),
          undefined,
          EMIT,
        )
        expect(await eventsFor(t.id)).toHaveLength(1)
        expect(await eventsFor(v.id)).toHaveLength(0)
      })
    })

    it('persists MMS attachment references once and hands them to the forwarder', async () => {
      const mms = normalized({
        source: 'V1_STORE',
        externalId: 'mms-1',
        attachments: [
          {
            attachmentId: '2',
            contentType: 'image/jpeg',
            sizeBytes: 230584,
            width: 1024,
            height: 768,
            rcUri: 'https://rc/content/2',
          },
          { attachmentId: '3', contentType: 'image/png', rcUri: 'https://rc/content/3' },
        ],
      })
      const m = await captureMessage(db, tenantId, mms)
      await captureMessage(db, tenantId, mms) // webhook + sync converge

      const rows = await db.messageAttachment.findMany({
        where: { messageId: m.id },
        orderBy: { attachmentId: 'asc' },
      })
      expect(rows.map((r) => [r.attachmentId, r.contentType, r.sizeBytes])).toEqual([
        ['2', 'image/jpeg', 230584],
        ['3', 'image/png', null],
      ])

      const pending = await listPendingForwards(db, 500)
      const row = pending.find((p) => p.messageId === m.id)
      expect(row?.message.attachments.map((a) => a.attachmentId).sort()).toEqual(['2', '3'])
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

  describe('listPendingForwards eligibility + fairness', () => {
    const tenantWith = async (slug: string, mssqlConnectionString: string | null) =>
      (
        await db.tenant.upsert({
          where: { slug },
          create: { name: slug, slug, mssqlConnectionString },
          update: { mssqlConnectionString },
        })
      ).id

    it('skips rows of tenants with no (null or empty) on-prem connection string', async () => {
      const noOnPrem = await tenantWith(SLUG_NO_ONPREM, null)
      const emptyOnPrem = await tenantWith(SLUG_EMPTY_ONPREM, '')
      const a = await captureMessage(db, noOnPrem, normalized({ externalId: 'no-onprem' }))
      const b = await captureMessage(db, emptyOnPrem, normalized({ externalId: 'empty-onprem' }))
      const c = await captureMessage(db, tenantId, normalized({ externalId: 'has-onprem' }))

      const ids = (await listPendingForwards(db, 500)).map((r) => r.messageId)
      expect(ids).toContain(c.id)
      expect(ids).not.toContain(a.id)
      expect(ids).not.toContain(b.id)

      // Untouched, not parked: the rows stay PENDING and drain once configured.
      const obx = await db.messageForwardOutbox.findUnique({ where: { messageId: a.id } })
      expect(obx?.status).toBe('PENDING')
      expect(obx?.attempts).toBe(0)
      await tenantWith(SLUG_NO_ONPREM, 'Server=onprem;')
      const afterConfig = (await listPendingForwards(db, 500)).map((r) => r.messageId)
      expect(afterConfig).toContain(a.id)
    })

    it('caps the drain per tenant so one backlog cannot crowd out another', async () => {
      const busy = await tenantWith(SLUG_BUSY, 'Server=busy;')
      // The busy tenant's rows are all older-due than the quiet tenant's row.
      for (let i = 0; i < 3; i++) {
        await captureMessage(db, busy, normalized({ externalId: `busy-${i}` }))
      }
      await db.messageForwardOutbox.updateMany({
        where: { tenantId: busy },
        data: { nextAttemptAt: new Date(Date.now() - 3_600_000) },
      })
      await captureMessage(db, tenantId, normalized({ externalId: 'quiet' }))

      const drained = await listPendingForwards(db, 2)
      expect(drained.filter((r) => r.tenantId === busy)).toHaveLength(2)
      // The other tenant still gets its turn in the same batch.
      expect(drained.some((r) => r.tenantId === tenantId)).toBe(true)
      for (const t of new Set(drained.map((r) => r.tenantId))) {
        expect(drained.filter((r) => r.tenantId === t).length).toBeLessThanOrEqual(2)
      }
      // Oldest-due first across the combined batch.
      const times = drained.map((r) => r.nextAttemptAt.getTime())
      expect(times).toEqual([...times].sort((x, y) => x - y))
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
