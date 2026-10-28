/**
 * Integration tests for crew links: the driver's share routes on /api/v1/labor
 * (sharing, mint, revoke) and the public crew-link endpoint a crew leader uses
 * (code, verify, job, packer selection, packer edits).
 *
 * Runs the real routers against Postgres, with Cedar evaluated offline. The
 * legacy activities live in an in-memory fake behind the mocked mssql-executor
 * client, and the outbound SMS is mocked so the texted code can be read back.
 *
 * Crews are platform-wide, so every number this file uses is in the
 * 404-555-04xx block and is wiped by that prefix.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'

vi.mock('../lib/mssql-executor-client', () => ({ executeSql: vi.fn() }))
vi.mock('../services/sms/outbound', () => ({ sendTenantSms: vi.fn() }))

import type { AppEnv } from '../types'
import { db } from '../db'
import { createTenantDb } from '../lib/prisma'
import { registerTestErrorHandler } from '../test-helpers'
import { executeSql } from '../lib/mssql-executor-client'
import { sendTenantSms } from '../services/sms/outbound'
import { laborHandler } from './labor'
import { crewLinkPublicHandler } from './crew-link-public'

const hasDb = Boolean(process.env['DATABASE_URL'])
const exec = executeSql as unknown as Mock
const sms = sendTenantSms as unknown as Mock

const SLUG_A = 'test-crew-link-a'
const SLUG_B = 'test-crew-link-b'
const PREFIX = '+1404555040'
const e164 = (n: number) => `${PREFIX}${n}`
const CREW = e164(1)
const OTHER_CREW = e164(2)

// ---------------------------------------------------------------------------
// Fake legacy database: the order's activities, with address, window and weight.
// ---------------------------------------------------------------------------
const row = (id: number, order: number, code: string, own: Record<string, unknown> = {}) => ({
  id,
  order_num: order,
  ActivityType_code: code,
  activityType_name: code,
  activityType_abbreviation: code,
  cl_type_name: `${code} name`,
  cl_type_abbreviation: code,
  planned_start: '2026-11-02T00:00:00.000Z',
  estimated_date: null,
  actual_date: null,
  street: '12 Elm St',
  unit: null,
  city: 'Atlanta',
  state: 'GA',
  zip: '30301',
  arrival_window_start: '08:00',
  arrival_window_end: '10:00',
  cl_est_wt: 8000,
  cl_actual_wt: null,
  assigned_driver_id: null,
  trip_driver_id: null,
  // A real legacy row carries the customer — the page must never show it.
  shipper_name: 'Customer Name',
  ...own,
})

let activities: ReturnType<typeof row>[] = []

function fakeExecute(
  _cs: string,
  _sql: string,
  opts?: { params?: Array<{ name: string; value: unknown }> },
) {
  const p = Object.fromEntries((opts?.params ?? []).map((x) => [x.name, x.value]))
  const recordset =
    'orderNum' in p
      ? activities.filter((a) => a.order_num === p['orderNum'])
      : activities.filter((a) => a.id === p['id'])
  return Promise.resolve({ recordset, rowsAffected: [] })
}

let tenantA: string
let tenantB: string
const U: Record<string, { id: string; tenantId: string; roles: string[] }> = {}

function appAs(who: string) {
  const u = U[who]!
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', u.tenantId)
    c.set('userId', u.id)
    c.set('correlationId', 'corr-test')
    c.set('principal', { sub: `sub-${who}`, tenantId: u.tenantId, roleNames: u.roles })
    c.set(
      'db',
      createTenantDb(db as unknown as PrismaClient, u.tenantId) as unknown as PrismaClient,
    )
    await next()
  })
  app.route('/labor', laborHandler)
  return app
}

const publicApp = () => {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.route('/crew-link', crewLinkPublicHandler)
  return app
}

const send = (body: unknown, method = 'POST', session?: string): RequestInit => ({
  method,
  headers: {
    'content-type': 'application/json',
    ...(session ? { 'x-crew-session': session } : {}),
  },
  body: JSON.stringify(body),
})

async function data<T = Record<string, unknown>>(res: Response): Promise<T> {
  return ((await res.json()) as { data: T }).data
}

async function codeOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { code?: string }).code
}

const linkPath = (order: number, phone: string) =>
  `/labor/orders/${order}/crews/${encodeURIComponent(phone)}/link`

async function share(who = 'driver', order = 9100, phone = CREW) {
  return appAs(who).request(linkPath(order, phone), { method: 'POST' })
}

/** Mint a link and return its token. */
async function mint(who = 'driver', order = 9100, phone = CREW): Promise<string> {
  const res = await share(who, order, phone)
  expect(res.status).toBe(201)
  const { url } = await data<{ url: string }>(res)
  return url.split('/c/')[1]!
}

/** The code the last OTP text carried. */
function lastCode(): string {
  const call = sms.mock.calls.at(-1)!
  return /(\d{6})/.exec((call[2] as { body: string }).body)![1]!
}

const otp = (token: string) => publicApp().request(`/crew-link/${token}/otp`, { method: 'POST' })
const verify = (token: string, code: string) =>
  publicApp().request(`/crew-link/${token}/verify`, send({ code }))

/** Mint, text a code, verify: the token and a live session. */
async function signIn(): Promise<{ token: string; session: string }> {
  const token = await mint()
  expect((await otp(token)).status).toBe(200)
  const res = await verify(token, lastCode())
  expect(res.status).toBe(200)
  return { token, session: (await data<{ session: string }>(res)).session }
}

const getJob = (token: string, session?: string) =>
  publicApp().request(`/crew-link/${token}/job`, {
    headers: session ? { 'x-crew-session': session } : {},
  })

async function wipe() {
  await db.crew.deleteMany({ where: { phone: { startsWith: PREFIX } } })
  for (const t of [tenantA, tenantB]) {
    await db.crewAccessLink.deleteMany({ where: { tenantId: t } })
    await db.activityLaborCrew.deleteMany({ where: { tenantId: t } })
    await db.ringCentralConnection.deleteMany({ where: { tenantId: t } })
    await db.tenantUser.deleteMany({ where: { tenantId: t } })
  }
}

afterAll(async () => {
  if (!hasDb) return
  await wipe().catch(() => undefined)
  await db.$disconnect()
})

describe.skipIf(!hasDb)('crew links (integration)', () => {
  const savedEnv = { ...process.env }

  beforeAll(async () => {
    process.env['AUTHZ_OFFLINE'] = 'true'
    const upsert = (slug: string) =>
      db.tenant.upsert({
        where: { slug },
        create: { name: slug, slug, mssqlConnectionString: 'Server=fake' },
        update: { mssqlConnectionString: 'Server=fake' },
      })
    tenantA = (await upsert(SLUG_A)).id
    tenantB = (await upsert(SLUG_B)).id
  })

  afterAll(() => {
    process.env = savedEnv
  })

  beforeEach(async () => {
    process.env['CREW_LEADER_LINK_ENABLED'] = 'true'
    process.env['CREW_LEADER_LINK_PUBLIC_WEB_URL'] = 'https://tenant.example/'
    process.env['RINGCENTRAL_ENABLED'] = 'true'
    exec.mockReset()
    exec.mockImplementation(fakeExecute)
    sms.mockReset()
    sms.mockResolvedValue({ kind: 'sent', id: 1, status: 'Queued', alreadySent: false })
    activities = [
      // Order 9100: driver 7 packs and loads; driver 8 delivers.
      row(901, 9100, 'PACK', { assigned_driver_id: 7 }),
      row(902, 9100, 'LOAD', { trip_driver_id: 7, actual_date: '2026-11-03T00:00:00.000Z' }),
      row(903, 9100, 'RDEL', { assigned_driver_id: 8 }),
      row(904, 9100, 'SITIN', { assigned_driver_id: 7 }),
    ]
    await wipe()
    const mk = async (key: string, tenantId: string, roles: string[], driver: number | null) => {
      const user = await db.tenantUser.create({
        data: {
          tenantId,
          email: `${key}@crew-link.test`,
          roleNames: roles,
          status: 'ACTIVE',
          longhaulDriverId: driver,
        },
      })
      U[key] = { id: user.id, tenantId, roles }
    }
    await mk('driver', tenantA, ['driver'], 7)
    await mk('other', tenantA, ['driver'], 8)
    await mk('ops', tenantA, ['operations_admin'], null)
    await mk('outsider', tenantB, ['driver'], 7)
    await db.ringCentralConnection.create({
      data: {
        tenantId: tenantA,
        rcAccountId: 'acct',
        rcExtensionId: 'ext',
        ownerNumber: '+14045550000',
        tokenSecretArn: 'arn:aws:secretsmanager:fake',
        scopes: [],
      },
    })
    for (const phone of [CREW, OTHER_CREW]) {
      await db.crew.create({
        data: {
          phone,
          name: phone === CREW ? 'Peach Crew' : 'Other Crew',
          createdByUserId: U['driver']!.id,
          updatedByUserId: U['driver']!.id,
        },
      })
    }
    const assign = (activityId: number, crewPhone: string) =>
      db.activityLaborCrew.create({
        data: {
          tenantId: tenantA,
          activityId,
          orderNum: 9100,
          crewPhone,
          assignedByUserId: U['driver']!.id,
        },
      })
    // The crew works driver 7's PACK and SITIN, and driver 8's RDEL — not the LOAD.
    await assign(901, CREW)
    await assign(904, CREW)
    await assign(903, CREW)
    await assign(902, OTHER_CREW)
  })

  // ── Sharing (driver side) ──────────────────────────────────────────────────

  it('reports sharing available only with the flag on and a working RingCentral connection', async () => {
    const available = async (who: string) =>
      (await data<{ available: boolean }>(await appAs(who).request('/labor/sharing'))).available
    expect(await available('driver')).toBe(true)
    expect(await available('outsider')).toBe(false) // tenant B has no connection
    process.env['RINGCENTRAL_ENABLED'] = 'false'
    expect(await available('driver')).toBe(false)
    process.env['RINGCENTRAL_ENABLED'] = 'true'
    process.env['CREW_LEADER_LINK_ENABLED'] = 'false'
    expect(await available('driver')).toBe(false)
  })

  it('mints a link to the tenant SPA, storing only the hash', async () => {
    const res = await share()
    expect(res.status).toBe(201)
    const { url } = await data<{ url: string }>(res)
    expect(url).toMatch(/^https:\/\/tenant\.example\/c\/crl_[0-9a-f]{48}$/)
    const token = url.split('/c/')[1]!
    const stored = await db.crewAccessLink.findMany({ where: { tenantId: tenantA } })
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      crewPhone: CREW,
      orderNum: 9100,
      sharedByUserId: U['driver']!.id,
    })
    expect(JSON.stringify(stored)).not.toContain(token)
  })

  it('refuses to mint without SMS, for a crew not on the order, or not on your activity', async () => {
    process.env['RINGCENTRAL_ENABLED'] = 'false'
    expect(await codeOf(await share())).toBe('SMS_UNAVAILABLE')
    process.env['RINGCENTRAL_ENABLED'] = 'true'
    expect(await codeOf(await share('driver', 9200))).toBe('CREW_NOT_ON_ORDER')
    // OTHER_CREW is only on the LOAD — driver 7's — so driver 8 can't share it.
    const res = await share('other', 9100, OTHER_CREW)
    expect(res.status).toBe(403)
    expect(await codeOf(res)).toBe('NOT_YOUR_ACTIVITY')
    // Operations may share any crew on the order.
    expect((await share('ops', 9100, OTHER_CREW)).status).toBe(201)
  })

  it('re-sharing revokes the previous link', async () => {
    const first = await mint()
    const second = await mint()
    expect(await codeOf(await otp(first))).toBe('LINK_INACTIVE')
    expect((await otp(second)).status).toBe(200)
  })

  it('stop sharing kills the link and its sessions', async () => {
    const { token, session } = await signIn()
    expect((await appAs('driver').request(linkPath(9100, CREW), { method: 'DELETE' })).status).toBe(
      204,
    )
    const res = await getJob(token, session)
    expect(res.status).toBe(404)
    expect(await codeOf(res)).toBe('LINK_INACTIVE')
  })

  // ── The one-time code ──────────────────────────────────────────────────────

  it('texts the code to the crew phone on file, never in the body of the link', async () => {
    const token = await mint()
    const res = await otp(token)
    expect(res.status).toBe(200)
    expect(await data(res)).toMatchObject({ sent: true, phoneHint: '•••• 0401' })
    expect(sms).toHaveBeenCalledTimes(1)
    const [, tenantId, msg] = sms.mock.calls[0]!
    expect(tenantId).toBe(tenantA)
    expect(msg.to).toBe(CREW)
    expect(msg.body).toMatch(/\b\d{6}\b/)
    expect(msg.body).not.toContain(token)
    expect(msg.dedupKey).toMatch(/^crew-otp:/)
  })

  it('answers every bad token with the same 404', async () => {
    for (const bad of ['nope', `crl_${'0'.repeat(48)}`]) {
      const res = await otp(bad)
      expect(res.status).toBe(404)
      expect(await codeOf(res)).toBe('LINK_INACTIVE')
    }
  })

  it('is a 404 when the crew is no longer on any activity of the order', async () => {
    const token = await mint()
    await db.activityLaborCrew.deleteMany({ where: { tenantId: tenantA, crewPhone: CREW } })
    expect(await codeOf(await otp(token))).toBe('LINK_INACTIVE')
  })

  it('caps codes at 3 per link per hour', async () => {
    const token = await mint()
    for (let i = 0; i < 3; i++) expect((await otp(token)).status).toBe(200)
    const res = await otp(token)
    expect(res.status).toBe(429)
    expect(await codeOf(res)).toBe('TOO_MANY_CODES')
  })

  it('caps codes at 10 per crew phone per day, across links', async () => {
    for (let i = 0; i < 3; i++) {
      const token = await mint()
      for (let j = 0; j < 3; j++) expect((await otp(token)).status).toBe(200)
    }
    const token = await mint()
    expect((await otp(token)).status).toBe(200)
    expect(await codeOf(await otp(token))).toBe('TOO_MANY_CODES')
  })

  it('reports an opted-out phone and a failed send', async () => {
    const token = await mint()
    sms.mockResolvedValueOnce({ kind: 'opted_out' })
    expect(await codeOf(await otp(token))).toBe('OPTED_OUT')
    sms.mockRejectedValueOnce(new Error('provider down'))
    const res = await otp(token)
    expect(res.status).toBe(502)
    expect(await codeOf(res)).toBe('SEND_FAILED')
  })

  it('accepts only the newest code, once', async () => {
    const token = await mint()
    await otp(token)
    const old = lastCode()
    await otp(token)
    const fresh = lastCode()
    if (old !== fresh) expect(await codeOf(await verify(token, old))).toBe('CODE_INCORRECT')
    expect((await verify(token, fresh)).status).toBe(200)
    expect(await codeOf(await verify(token, fresh))).toBe('CODE_EXPIRED')
  })

  it('rejects an expired code', async () => {
    const token = await mint()
    await otp(token)
    await db.crewAccessOtp.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
    expect(await codeOf(await verify(token, lastCode()))).toBe('CODE_EXPIRED')
  })

  it('burns the link after 5 wrong codes', async () => {
    const token = await mint()
    await otp(token)
    const right = lastCode()
    const wrong = right === '000000' ? '111111' : '000000'
    for (let left = 4; left >= 1; left--) {
      const res = await verify(token, wrong)
      expect(await res.json()).toMatchObject({ code: 'CODE_INCORRECT', attemptsLeft: left })
    }
    expect(await codeOf(await verify(token, wrong))).toBe('LINK_INACTIVE')
    expect(await codeOf(await verify(token, right))).toBe('LINK_INACTIVE')
    const audit = await db.crewAccessAudit.findMany({ where: { action: 'burned' } })
    expect(audit).toHaveLength(1)
  })

  it('a burst of parallel guesses gets no more than the limit', async () => {
    const token = await mint()
    await otp(token)
    const wrong = lastCode() === '000000' ? '111111' : '000000'
    const codes = await Promise.all(
      Array.from({ length: 12 }, async () => codeOf(await verify(token, wrong))),
    )
    // At most 4 come back "incorrect"; every other guess is refused as inactive.
    expect(codes.filter((c) => c === 'CODE_INCORRECT').length).toBeLessThanOrEqual(4)
    expect(codes.filter((c) => c === 'LINK_INACTIVE').length).toBeGreaterThanOrEqual(8)
    const link = await db.crewAccessLink.findFirstOrThrow({ where: { tenantId: tenantA } })
    expect(link.burnedAt).not.toBeNull()
  })

  // ── The job page ───────────────────────────────────────────────────────────

  it('needs a session for the job', async () => {
    const token = await mint()
    expect(await codeOf(await getJob(token))).toBe('SESSION_EXPIRED')
    expect(await codeOf(await getJob(token, `crs_${'0'.repeat(48)}`))).toBe('SESSION_EXPIRED')
  })

  it("does not accept another link's session", async () => {
    const { session } = await signIn()
    const otherToken = await mint('ops', 9100, OTHER_CREW)
    expect(await codeOf(await getJob(otherToken, session))).toBe('SESSION_EXPIRED')
  })

  it('shows the minimal job: this crew’s activities, address, window, weight — no customer', async () => {
    const { token, session } = await signIn()
    const res = await getJob(token, session)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    const job = await data<{
      crew: { name: string }
      weight: { estimated: number | null; actual: number | null }
      activities: Array<{
        id: number
        address: unknown
        arrivalWindow: unknown
        packerIds: string[]
      }>
    }>(res)
    expect(job.crew.name).toBe('Peach Crew')
    expect(job.weight).toEqual({ estimated: 8000, actual: null })
    expect(job.activities.map((a) => a.id)).toEqual([901, 903, 904])
    expect(job.activities[0]).toMatchObject({
      typeName: 'PACK name',
      plannedStart: '2026-11-02',
      arrivalWindow: { start: '08:00', end: '10:00' },
      address: { street: '12 Elm St', city: 'Atlanta', state: 'GA', zip: '30301' },
      packerIds: [],
    })
    // Storage work has no customer address.
    expect(job.activities[2]!.address).toBeNull()
    expect(JSON.stringify(job)).not.toContain('Customer Name')
  })

  it('404s the whole surface when the feature is off', async () => {
    const { token, session } = await signIn()
    process.env['CREW_LEADER_LINK_ENABLED'] = 'false'
    expect((await getJob(token, session)).status).toBe(404)
  })

  // ── Writes ─────────────────────────────────────────────────────────────────

  it('adds, edits and removes packers — attributed to the sharing driver, audited', async () => {
    const { token, session } = await signIn()
    const base = `/crew-link/${token}/packers`
    const created = await publicApp().request(
      base,
      send({ firstName: 'Ana', lastName: 'Ruiz', phone: '404-555-9999' }, 'POST', session),
    )
    expect(created.status).toBe(201)
    const { id } = await data<{ id: string }>(created)
    const stored = await db.packer.findUniqueOrThrow({ where: { id } })
    expect(stored).toMatchObject({ crewPhone: CREW, createdByUserId: U['driver']!.id })

    const patched = await publicApp().request(
      `${base}/${id}`,
      send({ firstName: 'Anna' }, 'PATCH', session),
    )
    expect(await data(patched)).toMatchObject({ firstName: 'Anna', lastName: 'Ruiz' })

    const removed = await publicApp().request(`${base}/${id}`, {
      method: 'DELETE',
      headers: { 'x-crew-session': session },
    })
    expect(removed.status).toBe(204)
    const actions = (await db.crewAccessAudit.findMany({ orderBy: { at: 'asc' } }))
      .map((a) => a.action)
      .filter((a) => a.startsWith('packer_'))
    expect(actions).toEqual(['packer_created', 'packer_updated', 'packer_deleted'])
  })

  it("can't touch another crew's packer", async () => {
    const theirs = await db.packer.create({
      data: {
        crewPhone: OTHER_CREW,
        firstName: 'X',
        lastName: 'Y',
        createdByUserId: U['driver']!.id,
        updatedByUserId: U['driver']!.id,
      },
    })
    const { token, session } = await signIn()
    const res = await publicApp().request(
      `/crew-link/${token}/packers/${theirs.id}`,
      send({ firstName: 'Z' }, 'PATCH', session),
    )
    expect(res.status).toBe(404)
    const sel = await publicApp().request(
      `/crew-link/${token}/activities/901/packers`,
      send({ packerIds: [theirs.id] }, 'PUT', session),
    )
    expect(await codeOf(sel)).toBe('PACKER_NOT_ON_CREW')
  })

  it('selects packers only on activities the driver gave this crew', async () => {
    const { token, session } = await signIn()
    const p = await publicApp().request(
      `/crew-link/${token}/packers`,
      send({ firstName: 'Bo', lastName: 'Lee', phone: '404-555-9998' }, 'POST', session),
    )
    const { id } = await data<{ id: string }>(p)
    const put = (activityId: number) =>
      publicApp().request(
        `/crew-link/${token}/activities/${activityId}/packers`,
        send({ packerIds: [id] }, 'PUT', session),
      )
    expect((await put(901)).status).toBe(200)
    // Activity 2 is the other crew's LOAD.
    expect(await codeOf(await put(902))).toBe('ACTIVITY_NOT_FOUND')
    const job = await data<{ activities: Array<{ id: number; packerIds: string[] }> }>(
      await getJob(token, session),
    )
    expect(job.activities.find((a) => a.id === 901)!.packerIds).toEqual([id])
    // The driver sees the same selection on the Labor tab.
    const sel = await db.activityLaborPacker.findMany({ where: { tenantId: tenantA } })
    expect(sel.map((s) => s.packerId)).toEqual([id])
  })
})
