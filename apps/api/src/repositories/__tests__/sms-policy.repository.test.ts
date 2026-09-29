/**
 * Integration tests for the SMS policy repositories (SmsOptOut, SmsSend) and
 * the inbound keyword hook.
 *
 * Run on the ROOT client on purpose: the RingCentral sync path that records
 * keyword opt-outs is cross-tenant, so these repositories must isolate tenants
 * by their own `tenantId` predicates, not by the Prisma extension.
 *
 * Requires a live PostgreSQL database. Skipped when DATABASE_URL is not set.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { toMessageId, toPhoneNumber } from '@pegasus/domain'
import { db } from '../../db'
import { createSmsOptOutRepository } from '../sms-opt-out.repository'
import { createSmsSendRepository } from '../sms-send.repository'
import { applyInboundKeyword } from '../../services/sms/opt-out-keywords'

const hasDb = Boolean(process.env['DATABASE_URL'])
const PHONE = '+15005550006'

let tenantAId: string
let tenantBId: string

afterAll(async () => {
  if (hasDb) {
    const tenantId = { in: [tenantAId, tenantBId] }
    await db.smsOptOut.deleteMany({ where: { tenantId } }).catch(() => undefined)
    await db.smsSend.deleteMany({ where: { tenantId } }).catch(() => undefined)
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('SMS policy repositories (integration)', () => {
  const root = db as unknown as PrismaClient
  const optOuts = createSmsOptOutRepository(root)
  const sends = createSmsSendRepository(root)
  const at = (iso: string) => new Date(iso)

  beforeAll(async () => {
    const [a, b] = await Promise.all(
      ['a', 'b'].map((x) =>
        db.tenant.upsert({
          where: { slug: `test-sms-policy-${x}` },
          create: { name: `Test Tenant (SMS policy ${x})`, slug: `test-sms-policy-${x}` },
          update: {},
        }),
      ),
    )
    tenantAId = a!.id
    tenantBId = b!.id
  })

  beforeEach(async () => {
    const tenantId = { in: [tenantAId, tenantBId] }
    await db.smsOptOut.deleteMany({ where: { tenantId } })
    await db.smsSend.deleteMany({ where: { tenantId } })
  })

  describe('SmsOptOut ordering', () => {
    const rec = (optedOut: boolean, iso: string, tenantId = tenantAId) =>
      optOuts.record({
        tenantId,
        phoneE164: PHONE,
        optedOut,
        source: 'KEYWORD',
        effectiveAt: at(iso),
      })

    it('applies newer events and ignores older ones, whatever order they arrive in', async () => {
      expect(await rec(true, '2026-09-25T20:00:00Z')).toBe('created') // STOP
      expect(await rec(false, '2026-09-26T09:00:00Z')).toBe('updated') // START, later
      // A backfill replays the old STOP: it must not undo the later START.
      expect(await rec(true, '2026-09-25T20:00:00Z')).toBe('stale')
      expect(await optOuts.isOptedOut(tenantAId, PHONE)).toBe(false)
    })

    it('re-capturing the same message is a no-op', async () => {
      await rec(true, '2026-09-25T20:00:00Z')
      expect(await rec(true, '2026-09-25T20:00:00Z')).toBe('stale')
      expect(await optOuts.isOptedOut(tenantAId, PHONE)).toBe(true)
    })

    it('is per tenant', async () => {
      await rec(true, '2026-09-25T20:00:00Z', tenantAId)
      expect(await optOuts.isOptedOut(tenantBId, PHONE)).toBe(false)
      expect(await optOuts.find(tenantBId, PHONE)).toBeNull()
    })
  })

  describe('applyInboundKeyword', () => {
    const inbound = (body: string, iso: string) => ({
      id: toMessageId('00000000-0000-4000-8000-000000000001'),
      direction: 'INBOUND' as const,
      fromNumber: toPhoneNumber(PHONE),
      body,
      rcCreationTime: at(iso),
    })

    it('records STOP with its keyword and message, then START re-subscribes', async () => {
      expect(
        await applyInboundKeyword(root, tenantAId, inbound('Stop!', '2026-09-25T20:00:00Z')),
      ).toBe('opted_out')
      expect(await optOuts.find(tenantAId, PHONE)).toMatchObject({
        optedOut: true,
        source: 'KEYWORD',
        keyword: 'STOP',
        messageId: '00000000-0000-4000-8000-000000000001',
      })
      expect(
        await applyInboundKeyword(root, tenantAId, inbound('START', '2026-09-26T09:00:00Z')),
      ).toBe('opted_in')
      expect(await optOuts.isOptedOut(tenantAId, PHONE)).toBe(false)
    })

    it('ignores ordinary replies and outbound messages', async () => {
      expect(
        await applyInboundKeyword(root, tenantAId, inbound('5, thanks!', '2026-09-25T20:00:00Z')),
      ).toBeNull()
      expect(
        await applyInboundKeyword(root, tenantAId, {
          ...inbound('STOP', '2026-09-25T20:00:00Z'),
          direction: 'OUTBOUND',
        }),
      ).toBeNull()
      expect(await optOuts.find(tenantAId, PHONE)).toBeNull()
    })
  })

  describe('SmsSend claims', () => {
    const claim = (tenantId = tenantAId) =>
      sends.claim({ tenantId, dedupKey: 'pulse:1:pack', toNumber: PHONE, bodyHash: 'h' })

    it('gives exactly one claim to concurrent senders with the same key', async () => {
      const results = await Promise.all(Array.from({ length: 6 }, () => claim()))
      expect(results.filter((r) => r.outcome === 'claimed')).toHaveLength(1)
    })

    it('lets exactly one retry reclaim a FAILED send', async () => {
      const first = await claim()
      await sends.markFailed(tenantAId, first.row.id, 'provider 503')
      const reclaims = await Promise.all([
        sends.reclaimFailed(tenantAId, first.row.id),
        sends.reclaimFailed(tenantAId, first.row.id),
      ])
      expect(reclaims.filter(Boolean)).toHaveLength(1)
    })

    it('keys are per tenant', async () => {
      await claim(tenantAId)
      expect((await claim(tenantBId)).outcome).toBe('claimed')
    })
  })
})
