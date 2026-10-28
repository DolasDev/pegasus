// ---------------------------------------------------------------------------
// Public crew-link endpoint — /api/public/v1/crew-link
//
// Where a crew leader (no login) staffs the activities a driver assigned their
// crew on one order. Mounted PRE-TENANT like the feedback endpoint: the caller
// carries only the opaque link token in the path, and the tenant is resolved
// FROM the token with the root `db`. The flow (lib/crew-link.ts):
//
//   POST /:token/otp     — text a one-time code to the crew's phone ON FILE.
//   POST /:token/verify  — trade the code for a session bearer.
//   GET  /:token/job     — (session) the minimal job + this crew's activities.
//   PUT  /:token/activities/:activityId/packers  — (session) who works it.
//   POST|PATCH|DELETE /:token/packers[/:id]       — (session) the crew's packers.
//
// The session travels in the X-Crew-Session header, never a cookie, and the
// link token sits in the path — so nothing here is CSRF-susceptible. A link is
// live while it is unexpired, unrevoked, unburned AND the crew is still assigned
// to an activity on the order; anything else is one uniform 404. Writes are
// attributed to the driver who shared the link and recorded in CrewAccessAudit.
// The whole surface 404s unless CREW_LEADER_LINK_ENABLED.
// ---------------------------------------------------------------------------

import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { DomainError, formatPhoneNumber } from '@pegasus/domain'
import type { CrewAccessLink, Prisma } from '@prisma/client'
import type { AppEnv } from '../types'
import { db as rootDb } from '../db'
import { logger } from '../lib/logger'
import { generateOpaqueToken, tokenMatches, tokenPrefixOf } from '../lib/opaque-token'
import {
  MAX_FAILED_ATTEMPTS,
  OTP_SENDS_PER_LINK_PER_HOUR,
  OTP_SENDS_PER_PHONE_PER_DAY,
  OTP_TTL_MS,
  SESSION_TTL_MS,
  crewJobActivities,
  crewJobActivityDto,
  crewJobWeights,
  crewLinkAvailable,
  generateOtpCode,
  hashOtp,
  isCrewLinkEnabled,
  otpMatches,
  phoneHint,
} from '../lib/crew-link'
import {
  LaborHttpError,
  PackerBody,
  createCrewPacker,
  deleteCrewPacker,
  packerDto,
  updateCrewPacker,
} from '../lib/labor-packers'
import { legacyConnectionString } from '../lib/chat-access'
import { sendTenantSms } from '../services/sms/outbound'

type C = Context<AppEnv>

const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS
const LINK_TOKEN = /^crl_[0-9a-f]{48}$/
const SESSION_TOKEN = /^crs_[0-9a-f]{48}$/

/** Unknown, expired, revoked, burned and no-longer-assigned all look the same. */
const linkInactive = () =>
  new LaborHttpError(
    404,
    'LINK_INACTIVE',
    'This link is no longer active. Ask your driver for a new one.',
  )

const sessionExpired = () =>
  new HttpError(401, 'SESSION_EXPIRED', 'Your session has ended. Request a new code.')

/** LaborHttpError has no 401/502 — the two statuses only this surface uses. */
class HttpError extends Error {
  constructor(
    readonly status: 401 | 502,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function guarded(c: C, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof DomainError) return c.json({ error: err.message, code: err.code }, 400)
    if (err instanceof LaborHttpError || err instanceof HttpError) {
      return c.json({ error: err.message, code: err.code }, err.status)
    }
    throw err
  }
}

async function readBody<T extends z.ZodType>(c: C, schema: T): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : ''
    throw new LaborHttpError(400, 'VALIDATION_ERROR', `${where}${issue?.message ?? 'Invalid body'}`)
  }
  return parsed.data
}

interface LiveLink {
  link: CrewAccessLink
  /** The order's activities this crew is assigned to — what the leader may staff. */
  activityIds: number[]
}

/** The live link the path token names, or the uniform 404. */
async function liveLink(c: C): Promise<LiveLink> {
  const token = c.req.param('token') ?? ''
  if (!LINK_TOKEN.test(token)) throw linkInactive()
  const candidates = await rootDb.crewAccessLink.findMany({
    where: { tokenPrefix: tokenPrefixOf(token) },
  })
  const link = candidates.find((row) => tokenMatches(token, row.tokenHash))
  const now = Date.now()
  if (!link || link.revokedAt || link.burnedAt || link.expiresAt.getTime() <= now) {
    throw linkInactive()
  }
  const assigned = await rootDb.activityLaborCrew.findMany({
    where: { tenantId: link.tenantId, orderNum: link.orderNum, crewPhone: link.crewPhone },
    select: { activityId: true },
  })
  if (assigned.length === 0) throw linkInactive()
  return { link, activityIds: assigned.map((a) => a.activityId) }
}

/** The live link plus a valid session for it (X-Crew-Session). */
async function authorised(c: C): Promise<LiveLink> {
  const live = await liveLink(c)
  const token = c.req.header('x-crew-session') ?? ''
  if (!SESSION_TOKEN.test(token)) throw sessionExpired()
  const sessions = await rootDb.crewAccessSession.findMany({
    where: { tokenPrefix: tokenPrefixOf(token), linkId: live.link.id },
  })
  const session = sessions.find((s) => tokenMatches(token, s.tokenHash))
  if (!session || session.expiresAt.getTime() <= Date.now()) throw sessionExpired()
  return live
}

function audit(
  linkId: string,
  action: string,
  extra: { packerId?: string; activityId?: number; detail?: Prisma.InputJsonValue } = {},
) {
  return rootDb.crewAccessAudit.create({ data: { linkId, action, ...extra } })
}

export const crewLinkPublicHandler = new Hono<AppEnv>()

crewLinkPublicHandler.use('*', async (c, next) => {
  if (!isCrewLinkEnabled()) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
  await next()
  // The token is in the URL: keep it out of caches and Referer headers.
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
})

// ── POST /:token/otp — text a code to the crew's phone on file ────────────────
crewLinkPublicHandler.post('/:token/otp', (c) =>
  guarded(c, async () => {
    const { link } = await liveLink(c)
    if (!(await crewLinkAvailable(rootDb, link.tenantId))) {
      throw new LaborHttpError(
        409,
        'SMS_UNAVAILABLE',
        "Texting isn't set up for this company yet, so a code can't be sent.",
      )
    }
    const now = Date.now()
    const [forLink, forPhone] = await Promise.all([
      rootDb.crewAccessOtp.count({
        where: { linkId: link.id, createdAt: { gt: new Date(now - HOUR_MS) } },
      }),
      rootDb.crewAccessOtp.count({
        where: {
          link: { crewPhone: link.crewPhone },
          createdAt: { gt: new Date(now - DAY_MS) },
        },
      }),
    ])
    if (forLink >= OTP_SENDS_PER_LINK_PER_HOUR || forPhone >= OTP_SENDS_PER_PHONE_PER_DAY) {
      throw new LaborHttpError(429, 'TOO_MANY_CODES', 'Too many codes requested. Try again later.')
    }

    // The row is written before the text goes out, so a failed send still
    // counts toward the limits — retrying can't be used to spam the phone.
    const code = generateOtpCode()
    const expiresAt = new Date(now + OTP_TTL_MS)
    const otp = await rootDb.crewAccessOtp.create({
      data: { linkId: link.id, codeHash: hashOtp(link.id, code), expiresAt },
    })
    let result: Awaited<ReturnType<typeof sendTenantSms>>
    try {
      result = await sendTenantSms(rootDb, link.tenantId, {
        to: link.crewPhone,
        body: `Pegasus: your crew access code is ${code}. It expires in 10 minutes.`,
        dedupKey: `crew-otp:${otp.id}`,
      })
    } catch (err) {
      logger.warn('crew link code send failed', { tenantId: link.tenantId, error: String(err) })
      throw new HttpError(502, 'SEND_FAILED', "The code couldn't be sent. Try again in a minute.")
    }
    if (result.kind === 'opted_out') {
      throw new LaborHttpError(
        409,
        'OPTED_OUT',
        'This phone has opted out of texts from this company. Reply START to their number to opt back in.',
      )
    }
    if (result.kind === 'disabled' || result.kind === 'no_connection') {
      throw new LaborHttpError(
        409,
        'SMS_UNAVAILABLE',
        "Texting isn't set up for this company yet, so a code can't be sent.",
      )
    }
    if (result.kind !== 'sent') {
      throw new HttpError(502, 'SEND_FAILED', "The code couldn't be sent. Try again in a minute.")
    }
    await audit(link.id, 'otp_sent')
    return c.json({
      data: {
        sent: true,
        phoneHint: phoneHint(link.crewPhone),
        expiresAt: expiresAt.toISOString(),
      },
    })
  }),
)

const VerifyBody = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') })

// ── POST /:token/verify — trade the newest code for a session ─────────────────
crewLinkPublicHandler.post('/:token/verify', (c) =>
  guarded(c, async () => {
    const { link } = await liveLink(c)
    const { code } = await readBody(c, VerifyBody)
    const otp = await rootDb.crewAccessOtp.findFirst({
      where: { linkId: link.id },
      orderBy: { createdAt: 'desc' },
    })
    const now = Date.now()
    if (!otp || otp.consumedAt || otp.expiresAt.getTime() <= now) {
      throw new LaborHttpError(400, 'CODE_EXPIRED', 'That code has expired. Request a new one.')
    }

    // Every attempt is counted BEFORE the compare (increment-then-read is
    // atomic), so a burst of parallel guesses can't all land inside the limit.
    // A correct code resets the count below.
    const { failedAttempts } = await rootDb.crewAccessLink.update({
      where: { id: link.id },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    })
    const burn = async () => {
      await rootDb.crewAccessLink.update({
        where: { id: link.id },
        data: { burnedAt: new Date(now) },
      })
      await audit(link.id, 'burned')
      logger.warn('crew link burned after too many wrong codes', {
        tenantId: link.tenantId,
        orderNum: link.orderNum,
        linkId: link.id,
      })
      return linkInactive()
    }
    if (failedAttempts > MAX_FAILED_ATTEMPTS) throw await burn()

    if (!otpMatches(link.id, code, otp.codeHash)) {
      if (failedAttempts >= MAX_FAILED_ATTEMPTS) throw await burn()
      return c.json(
        {
          error: "That code isn't right.",
          code: 'CODE_INCORRECT',
          attemptsLeft: MAX_FAILED_ATTEMPTS - failedAttempts,
        },
        400,
      )
    }

    const minted = generateOpaqueToken('crs')
    const expiresAt = new Date(Math.min(now + SESSION_TTL_MS, link.expiresAt.getTime()))
    const consumed = await rootDb.$transaction(async (tx) => {
      // Single use: a concurrent verify of the same code gets nothing.
      const { count } = await tx.crewAccessOtp.updateMany({
        where: { id: otp.id, consumedAt: null },
        data: { consumedAt: new Date(now) },
      })
      if (count === 0) return false
      await tx.crewAccessLink.update({ where: { id: link.id }, data: { failedAttempts: 0 } })
      await tx.crewAccessSession.create({
        data: {
          linkId: link.id,
          tokenPrefix: minted.tokenPrefix,
          tokenHash: minted.tokenHash,
          expiresAt,
        },
      })
      return true
    })
    if (!consumed) {
      throw new LaborHttpError(400, 'CODE_EXPIRED', 'That code has expired. Request a new one.')
    }
    await audit(link.id, 'verified')
    return c.json({ data: { session: minted.plainToken, expiresAt: expiresAt.toISOString() } })
  }),
)

// ── GET /:token/job — the job, this crew's activities and its packers ─────────
crewLinkPublicHandler.get('/:token/job', (c) =>
  guarded(c, async () => {
    const { link, activityIds } = await authorised(c)
    const cs = await legacyConnectionString(link.tenantId)
    let rows: Awaited<ReturnType<typeof crewJobActivities>> | null = null
    if (cs) {
      try {
        rows = await crewJobActivities(cs, link.orderNum)
      } catch (err) {
        logger.warn('crew link legacy read failed', { tenantId: link.tenantId, error: String(err) })
      }
    }
    if (!rows) {
      throw new LaborHttpError(
        503,
        'LEGACY_UNAVAILABLE',
        'The job details are unavailable right now',
      )
    }

    const [crew, assigned] = await Promise.all([
      rootDb.crew.findUniqueOrThrow({
        where: { phone: link.crewPhone },
        include: { packers: { orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] } },
      }),
      rootDb.activityLaborCrew.findMany({
        where: { tenantId: link.tenantId, orderNum: link.orderNum, crewPhone: link.crewPhone },
        select: { activityId: true, packers: { select: { packerId: true } } },
      }),
    ])
    const selected = new Map(assigned.map((a) => [a.activityId, a.packers.map((p) => p.packerId)]))
    const mine = new Set(activityIds)
    return c.json({
      data: {
        orderNum: link.orderNum,
        crew: { name: crew.name, phoneDisplay: formatPhoneNumber(crew.phone) },
        weight: crewJobWeights(rows),
        activities: rows
          .filter((r) => mine.has(r.id))
          .map((r) => ({ ...crewJobActivityDto(r), packerIds: selected.get(r.id) ?? [] })),
        packers: crew.packers.map(packerDto),
        linkExpiresAt: link.expiresAt.toISOString(),
      },
    })
  }),
)

const SelectionBody = z.object({ packerIds: z.array(z.string()).max(200) })

// ── PUT /:token/activities/:activityId/packers — who of the crew works it ─────
crewLinkPublicHandler.put('/:token/activities/:activityId/packers', (c) =>
  guarded(c, async () => {
    const { link } = await authorised(c)
    const activityId = Number(c.req.param('activityId'))
    if (!Number.isSafeInteger(activityId) || activityId <= 0) {
      throw new LaborHttpError(400, 'VALIDATION_ERROR', 'Invalid activityId')
    }
    const packerIds = [...new Set((await readBody(c, SelectionBody)).packerIds)]
    // Only an activity the driver assigned this crew to — never a new one.
    const assignment = await rootDb.activityLaborCrew.findFirst({
      where: {
        tenantId: link.tenantId,
        activityId,
        orderNum: link.orderNum,
        crewPhone: link.crewPhone,
      },
      select: { id: true },
    })
    if (!assignment) {
      throw new LaborHttpError(404, 'ACTIVITY_NOT_FOUND', "Your crew isn't on that activity")
    }
    const onCrew = await rootDb.packer.count({
      where: { id: { in: packerIds }, crewPhone: link.crewPhone },
    })
    if (onCrew !== packerIds.length) {
      throw new LaborHttpError(422, 'PACKER_NOT_ON_CREW', 'A selected packer is not on your crew')
    }
    await rootDb.$transaction([
      rootDb.activityLaborPacker.deleteMany({ where: { activityLaborCrewId: assignment.id } }),
      rootDb.activityLaborPacker.createMany({
        data: packerIds.map((packerId) => ({
          activityLaborCrewId: assignment.id,
          tenantId: link.tenantId,
          packerId,
        })),
      }),
    ])
    await audit(link.id, 'packers_selected', { activityId, detail: { packerIds } })
    return c.json({ data: { activityId, packerIds } })
  }),
)

// ── Packers of the crew — attributed to the driver who shared the link ────────
crewLinkPublicHandler.post('/:token/packers', (c) =>
  guarded(c, async () => {
    const { link } = await authorised(c)
    const input = await readBody(c, PackerBody)
    const row = await createCrewPacker(rootDb, link.crewPhone, input, link.sharedByUserId)
    await audit(link.id, 'packer_created', { packerId: row.id })
    return c.json({ data: packerDto(row) }, 201)
  }),
)

crewLinkPublicHandler.patch('/:token/packers/:id', (c) =>
  guarded(c, async () => {
    const { link } = await authorised(c)
    const input = await readBody(c, PackerBody.partial())
    const row = await updateCrewPacker(
      rootDb,
      link.crewPhone,
      c.req.param('id') ?? '',
      input,
      link.sharedByUserId,
    )
    await audit(link.id, 'packer_updated', { packerId: row.id })
    return c.json({ data: packerDto(row) })
  }),
)

crewLinkPublicHandler.delete('/:token/packers/:id', (c) =>
  guarded(c, async () => {
    const { link } = await authorised(c)
    const packerId = c.req.param('id') ?? ''
    await deleteCrewPacker(rootDb, link.crewPhone, packerId)
    await audit(link.id, 'packer_deleted', { packerId })
    return c.body(null, 204)
  }),
)
