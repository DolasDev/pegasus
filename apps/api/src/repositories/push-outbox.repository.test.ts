/**
 * Integration tests for the push outbox claim — the guard that stops the
 * scheduled forwarder run and a kicked one (or any two overlapping runs) from
 * delivering one row twice.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { db } from '../db'
import {
  enqueuePush,
  claimPush,
  listPendingPush,
  markPushFailed,
  PUSH_CLAIM_LEASE_MS,
} from './push-outbox.repository'

/** The row if `listPendingPush` (the forwarder's read) currently sees it as due. */
async function dueRow(id: string, now: Date = new Date()) {
  return (await listPendingPush(db, 1000, now)).find((r) => r.id === id)
}

const hasDb = Boolean(process.env['DATABASE_URL'])
const SLUG = 'test-push-claim'

let tenantId: string
let userId: string

afterAll(async () => {
  if (hasDb) {
    await db.pushNotificationOutbox.deleteMany({ where: { tenantId } }).catch(() => undefined)
    await db.tenantUser.deleteMany({ where: { tenantId } }).catch(() => undefined)
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('push outbox claim (integration)', () => {
  beforeAll(async () => {
    const tenant = await db.tenant.upsert({
      where: { slug: SLUG },
      create: { name: SLUG, slug: SLUG },
      update: {},
    })
    tenantId = tenant.id
    await db.pushNotificationOutbox.deleteMany({ where: { tenantId } })
    await db.tenantUser.deleteMany({ where: { tenantId } })
    userId = (await db.tenantUser.create({ data: { tenantId, email: 'driver@claim.test' } })).id
  })

  beforeEach(async () => {
    await db.pushNotificationOutbox.deleteMany({ where: { tenantId } })
  })

  async function enqueue(): Promise<string> {
    return db.$transaction((tx) =>
      enqueuePush(tx, tenantId, { userId, payload: { title: 't', body: 'b' } }),
    )
  }

  it('lets exactly one of two concurrent claims on the same row win', async () => {
    const id = await enqueue()
    const row = await dueRow(id)
    expect(row).toBeDefined()

    const results = await Promise.all([claimPush(db, row!), claimPush(db, row!)])

    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('hides a claimed row from due reads until the lease expires', async () => {
    const id = await enqueue()
    const row = await dueRow(id)
    const now = new Date()

    expect(await claimPush(db, row!, now)).toBe(true)

    expect(await dueRow(id, now)).toBeUndefined()
    const afterLease = new Date(now.getTime() + PUSH_CLAIM_LEASE_MS + 1)
    expect(await dueRow(id, afterLease)).toBeDefined()
  })

  it('refuses a claim from a stale read', async () => {
    const id = await enqueue()
    const stale = await dueRow(id)
    await markPushFailed(db, id, {
      nextStatus: 'FAILED',
      error: 'boom',
      nextAttemptAt: new Date(Date.now() - 1000),
    })

    expect(await claimPush(db, stale!)).toBe(false)
  })

  it('never claims a row that is already SENT or DEAD', async () => {
    const id = await enqueue()
    const row = await dueRow(id)
    await db.pushNotificationOutbox.update({ where: { id }, data: { status: 'DEAD' } })

    expect(await claimPush(db, row!)).toBe(false)
    expect(await dueRow(id)).toBeUndefined()
  })
})
