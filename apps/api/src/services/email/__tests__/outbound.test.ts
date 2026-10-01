/**
 * Integration tests for sendTenantEmail against a real Postgres: the allowed-
 * domain policy reads the tenant's real app settings, and the dedup claim,
 * FAILED reclaim and daily-limit counter run on the real email_sends table.
 * The pegII gateway is a fake — no tunnel.
 *
 * Skipped when DATABASE_URL is not set.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { db } from '../../../db'
import { createTenantDb } from '../../../lib/prisma'
import { updateAppSettings } from '../../../lib/app-settings'
import { sendTenantEmail, DAILY_EMAIL_LIMIT, type OutboundEmailInput } from '../outbound'
import { PegiiApiError } from '../../../lib/pegii-api-client'

const hasDb = Boolean(process.env['DATABASE_URL'])
let tenantId: string
let tdb: PrismaClient

afterAll(async () => {
  if (hasDb) {
    await db.emailSend.deleteMany({ where: { tenantId } }).catch(() => undefined)
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('sendTenantEmail (integration)', () => {
  const send = vi.fn()
  const gateway = async () => ({ send })
  const email = (overrides: Partial<OutboundEmailInput> = {}): OutboundEmailInput => ({
    to: ['coord@nwmovers.test'],
    cc: ['lead@NWMovers.test'],
    subject: 'Negative Pack Pulse Survey Text Received for Order Number: 490317',
    body: 'Customer Reply: 2',
    bodyType: 'text',
    ...overrides,
  })

  beforeAll(async () => {
    const t = await db.tenant.upsert({
      where: { slug: 'test-email-outbound' },
      create: { name: 'Test Tenant (email outbound)', slug: 'test-email-outbound' },
      update: {},
    })
    tenantId = t.id
    tdb = createTenantDb(db as unknown as PrismaClient, tenantId) as unknown as PrismaClient
  })

  beforeEach(async () => {
    send.mockReset().mockResolvedValue(undefined)
    await db.emailSend.deleteMany({ where: { tenantId } })
    await updateAppSettings(db as unknown as PrismaClient, tenantId, {
      operations: { emailAllowedRecipientDomains: ['nwmovers.test'] },
    })
  })

  it('refuses everything until allowed domains are configured', async () => {
    await updateAppSettings(db as unknown as PrismaClient, tenantId, {
      operations: { emailAllowedRecipientDomains: [] },
    })
    expect(await sendTenantEmail(tdb, tenantId, email(), gateway)).toEqual({
      kind: 'not_configured',
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses any recipient outside the allowed domains, case-insensitively checked', async () => {
    const result = await sendTenantEmail(
      tdb,
      tenantId,
      email({ cc: ['someone@gmail.test', 'lead@nwmovers.test'] }),
      gateway,
    )
    expect(result).toEqual({ kind: 'recipient_not_allowed', recipients: ['someone@gmail.test'] })
    expect(send).not.toHaveBeenCalled()
  })

  it('sends through the gateway and records the send', async () => {
    const result = await sendTenantEmail(tdb, tenantId, email(), gateway)
    expect(result).toMatchObject({ kind: 'sent', alreadySent: false })
    expect(send).toHaveBeenCalledWith({
      to: ['coord@nwmovers.test'],
      cc: ['lead@NWMovers.test'],
      subject: expect.stringContaining('490317'),
      body: 'Customer Reply: 2',
      bodyType: 'text',
    })
    const rows = await db.emailSend.findMany({ where: { tenantId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'SENT', dedupKey: null })
  })

  it('a retry with the same dedup key returns the first send without mailing again', async () => {
    const first = await sendTenantEmail(
      tdb,
      tenantId,
      email({ dedupKey: 'pulse:1:load:esc' }),
      gateway,
    )
    const again = await sendTenantEmail(
      tdb,
      tenantId,
      email({ dedupKey: 'pulse:1:load:esc' }),
      gateway,
    )
    expect(again).toEqual({ kind: 'sent', id: (first as { id: string }).id, alreadySent: true })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('refuses a reused key with a different body', async () => {
    await sendTenantEmail(tdb, tenantId, email({ dedupKey: 'k1' }), gateway)
    expect(
      await sendTenantEmail(tdb, tenantId, email({ dedupKey: 'k1', body: 'different' }), gateway),
    ).toEqual({ kind: 'key_reused' })
  })

  it('marks a gateway failure FAILED and lets exactly the next retry reclaim it', async () => {
    send.mockRejectedValueOnce(new PegiiApiError('PEGII_API_TUNNEL_ERROR', 'down'))
    await expect(
      sendTenantEmail(tdb, tenantId, email({ dedupKey: 'k2' }), gateway),
    ).rejects.toMatchObject({ code: 'PEGII_API_TUNNEL_ERROR' })
    expect((await db.emailSend.findFirst({ where: { tenantId, dedupKey: 'k2' } }))?.status).toBe(
      'FAILED',
    )
    expect(await sendTenantEmail(tdb, tenantId, email({ dedupKey: 'k2' }), gateway)).toMatchObject({
      kind: 'sent',
      alreadySent: false,
    })
  })

  it('reports a recent PENDING key as in progress and a stale one as in doubt', async () => {
    // Leave one send stuck mid-flight: the gateway call never resolves.
    send.mockImplementationOnce(() => new Promise(() => undefined)) // never resolves
    void sendTenantEmail(tdb, tenantId, email({ dedupKey: 'k4' }), gateway)
    await vi.waitFor(async () => {
      expect(await db.emailSend.count({ where: { tenantId, dedupKey: 'k4' } })).toBe(1)
    })
    expect(await sendTenantEmail(tdb, tenantId, email({ dedupKey: 'k4' }), gateway)).toEqual({
      kind: 'in_progress',
    })
    const later = () => new Date(Date.now() + 10 * 60 * 1000)
    expect(await sendTenantEmail(tdb, tenantId, email({ dedupKey: 'k4' }), gateway, later)).toEqual(
      {
        kind: 'in_doubt',
      },
    )
  })

  it('stops at the daily limit', async () => {
    await db.emailSend.createMany({
      data: Array.from({ length: DAILY_EMAIL_LIMIT }, (_, i) => ({
        tenantId,
        dedupKey: `bulk-${i}`,
        toAddresses: ['coord@nwmovers.test'],
        ccAddresses: [],
        subject: 's',
        requestHash: 'h',
        status: 'SENT' as const,
      })),
    })
    expect(await sendTenantEmail(tdb, tenantId, email(), gateway)).toEqual({ kind: 'daily_limit' })
    expect(send).not.toHaveBeenCalled()
  })

  it('enforces the recipient and size caps before touching the database', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `u${i}@nwmovers.test`)
    expect(await sendTenantEmail(tdb, tenantId, email({ to: eleven, cc: [] }), gateway)).toEqual({
      kind: 'too_many_recipients',
    })
    expect(
      await sendTenantEmail(tdb, tenantId, email({ body: 'x'.repeat(100 * 1024 + 1) }), gateway),
    ).toEqual({ kind: 'body_too_large' })
    expect(await db.emailSend.count({ where: { tenantId } })).toBe(0)
  })
})
