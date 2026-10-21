// ---------------------------------------------------------------------------
// Labor — /api/v1/labor
//
// A driver's private book of cash-labor crews (the mobile app's Labor module).
// A crew is a PLATFORM-WIDE record keyed by its E.164 phone number: every
// driver — at any tenant — who adds that number shares the crew's name,
// service areas and packers, and any of them may edit those. What stays
// private to each driver hangs off their own `CrewLink`: a nickname, and a
// 1–5 star rating with a comment. Other drivers' ratings are only ever shown
// as an anonymous average, from MIN_RATERS_FOR_AVERAGE raters.
//
// Access is the link: every crew route resolves the CALLER'S link to the crew
// first, and a crew they haven't added is a 404 — knowing a crew's phone
// number (and adding it) is what grants access, exactly like a phone book.
// Adds are rate-limited per user so the number space can't be walked.
//
// Mounted on the Cognito-only tenant router; the handler also refuses an
// `apiClient` caller. Cedar grants Read/WriteLabor to every principal
// (56-labor-shared.cedar) — there is no role to gate on, since a user can only
// reach crews they added themselves. Plan: plans/in-progress/labor-crews.md.
// ---------------------------------------------------------------------------

import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { Prisma, type Packer } from '@prisma/client'
import {
  DomainError,
  aggregateRating,
  foldKey,
  formatPhoneNumber,
  normalizeNickname,
  normalizePhoneNumber,
  parseLocationQuery,
  rankCrewsByDistance,
  validateCrew,
  validatePacker,
  validateRating,
  validateServiceAreas,
  type ExportCrew,
  type GeoPoint,
  type LocationQuery,
} from '@pegasus/domain'
import type { AppEnv } from '../types'
import { requirePermission } from '../middleware/rbac'
import { Actions } from '../authz/actions'
import {
  countLinksSince,
  createLink,
  ensureCrew,
  findCities,
  findCity,
  findMyLink,
  findPostalCode,
  listMyLinks,
  listPackers,
  replaceServiceAreas,
  crewNames,
  searchCities,
  starsByCrew,
  type CrewLinkRow,
} from '../repositories/labor.repository'

/** New crews a user may add per rolling 24 hours. */
export const LINK_RATE_LIMIT = 100
const RATE_WINDOW_MS = 24 * 60 * 60_000
export const MAX_IMPORT_ROWS = 200
const PLACES_LIMIT = 20

type C = Context<AppEnv>

class LaborHttpError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 429,
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
    const correlationId = c.get('correlationId')
    if (err instanceof DomainError) {
      return c.json({ error: err.message, code: err.code, correlationId }, 400)
    }
    if (err instanceof LaborHttpError) {
      return c.json({ error: err.message, code: err.code, correlationId }, err.status)
    }
    throw err
  }
}

interface Caller {
  userId: string
  tenantId: string
}

function caller(c: C): Caller {
  if (c.get('apiClient')) {
    throw new LaborHttpError(403, 'LABOR_HUMANS_ONLY', 'Labor is for signed-in users only')
  }
  const userId = c.get('userId')
  if (!userId) throw new LaborHttpError(403, 'USER_NOT_FOUND', 'No user record for this login')
  return { userId, tenantId: c.get('tenantId') }
}

/**
 * The `:phone` path segment, normalised — any spelling of the number works.
 * Hono has already percent-decoded it; decoding again would turn `%25zz` into
 * a URIError (a 500) instead of a 400.
 */
function phoneParam(c: C): string {
  return normalizePhoneNumber(c.req.param('phone') ?? '')
}

async function requireLink(c: C, who: Caller, phone: string): Promise<CrewLinkRow> {
  const link = await findMyLink(c.get('db'), who.userId, phone)
  if (!link) throw new LaborHttpError(404, 'CREW_NOT_FOUND', 'Crew not in your list')
  return link
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

/** How many more crews the caller may add right now. */
async function addBudget(c: C, who: Caller): Promise<number> {
  const since = new Date(Date.now() - RATE_WINDOW_MS)
  return LINK_RATE_LIMIT - (await countLinksSince(c.get('db'), who.userId, since))
}

const todayIso = () => new Date().toISOString().slice(0, 10)
const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
const toDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00.000Z`) : null)

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

function crewDto(link: CrewLinkRow, stars: readonly number[] | undefined) {
  const { crew, rating } = link
  return {
    phone: crew.phone,
    phoneDisplay: formatPhoneNumber(crew.phone),
    name: crew.name,
    nickname: link.nickname,
    displayName: link.nickname ?? crew.name,
    email: crew.email,
    serviceAreas: crew.serviceAreas.map((a) => ({
      id: a.id,
      city: a.city,
      region: a.region,
      country: a.country,
      geocoded: a.lat !== null && a.lon !== null,
    })),
    packerCount: crew._count.packers,
    myRating: rating
      ? { stars: rating.stars, comment: rating.comment, updatedAt: rating.updatedAt.toISOString() }
      : null,
    averageRating: aggregateRating(stars ?? []),
    addedAt: link.createdAt.toISOString(),
  }
}

type CrewDto = ReturnType<typeof crewDto>

function packerDto(p: Packer) {
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    cidNumber: p.cidNumber,
    cidIssuedOn: dateOnly(p.cidIssuedOn),
    phone: p.phone,
    phoneDisplay: p.phone ? formatPhoneNumber(p.phone) : null,
    updatedAt: p.updatedAt.toISOString(),
  }
}

async function crewDtos(c: C, links: readonly CrewLinkRow[]): Promise<CrewDto[]> {
  const stars = await starsByCrew(
    c.get('db'),
    links.map((l) => l.crewPhone),
  )
  return links.map((l) => crewDto(l, stars.get(l.crewPhone)))
}

/** The crew at `phone` as the caller sees it, with its packers. */
async function crewDetail(c: C, who: Caller, phone: string) {
  const link = await requireLink(c, who, phone)
  const [[dto], packers] = await Promise.all([crewDtos(c, [link]), listPackers(c.get('db'), phone)])
  return { ...dto!, packers: packers.map(packerDto) }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

interface SearchLocation extends GeoPoint {
  label: string
}

const byName = (a: CrewDto, b: CrewDto) => a.displayName.localeCompare(b.displayName)

/** Where a ZIP/postal code or "City, ST" query is centred, if we know it. */
async function resolveOrigin(
  c: C,
  q: Extract<LocationQuery, { kind: 'postal' | 'city' }>,
): Promise<SearchLocation | undefined> {
  const db = c.get('db')
  if (q.kind === 'postal') {
    const p = await findPostalCode(db, q.country, q.code)
    return p ? { lat: p.lat, lon: p.lon, label: `${q.code} (${p.region})` } : undefined
  }
  const city = await findCity(db, q.cityKey, q.region)
  return city ? { lat: city.lat, lon: city.lon, label: `${city.name}, ${city.region}` } : undefined
}

function matchesText(crew: CrewDto, text: string): boolean {
  const key = foldKey(text)
  // Text with letters is a name search; only digits-and-punctuation matches phones.
  const digits = /\p{L}/u.test(text) ? '' : text.replace(/\D/g, '')
  return (
    (key !== '' &&
      (foldKey(crew.name).includes(key) || foldKey(crew.nickname ?? '').includes(key))) ||
    (digits.length >= 3 && crew.phone.includes(digits))
  )
}

/** Nearest first from `origin`, on the stored service-area coordinates. */
function rankFrom(links: readonly CrewLinkRow[], dtos: readonly CrewDto[], origin: SearchLocation) {
  const areas = new Map(links.map((l) => [l.crewPhone, l.crew.serviceAreas]))
  return rankCrewsByDistance(
    dtos.map((dto) => ({ dto, name: dto.displayName, serviceAreas: areas.get(dto.phone) ?? [] })),
    origin,
  ).map((r) => ({ ...r.dto, distanceMiles: r.distanceMiles }))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const laborHandler = new Hono<AppEnv>()

// GET /crews?q= — my crews. Empty q: A–Z. A ZIP, postal code or "City, ST":
// nearest first. A state/province: crews serving it, A–Z. Other text: crews
// whose name, nickname or phone matches — or, when none do and the text is a
// city name, nearest first from that city.
laborHandler.get('/crews', requirePermission(Actions.ReadLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const db = c.get('db')
    const links = await listMyLinks(db, who.userId)
    const crews = await crewDtos(c, links)
    const query = parseLocationQuery(c.req.query('q') ?? '')
    const list = (data: unknown[], location: SearchLocation | null, notFound = false) =>
      c.json({ data, meta: { location, ...(notFound ? { locationNotFound: true } : {}) } })

    switch (query.kind) {
      case 'none':
        return list(crews.sort(byName), null)
      case 'region':
        return list(
          crews.filter((cr) => cr.serviceAreas.some((a) => a.region === query.region)).sort(byName),
          null,
        )
      case 'postal':
      case 'city': {
        const origin = await resolveOrigin(c, query)
        return origin ? list(rankFrom(links, crews, origin), origin) : list([], null, true)
      }
      case 'text': {
        const hits = crews.filter((cr) => matchesText(cr, query.text))
        if (hits.length) return list(hits.sort(byName), null)
        const city = await findCity(db, foldKey(query.text))
        if (!city) return list([], null)
        const origin = { lat: city.lat, lon: city.lon, label: `${city.name}, ${city.region}` }
        return list(rankFrom(links, crews, origin), origin)
      }
    }
  }),
)

const AddCrewBody = z.object({
  phone: z.string(),
  name: z.string(),
  email: z.string().nullish(),
  nickname: z.string().nullish(),
})

// POST /crews { phone, name, email?, nickname? } — add a crew to my list. A
// number someone else already added links me to their crew (its shared name
// stands; mine becomes my nickname when it differs). Idempotent.
laborHandler.post('/crews', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const input = await readBody(c, AddCrewBody)
    const crew = validateCrew(input)
    const nickname = normalizeNickname(input.nickname)
    const db = c.get('db')

    if (await findMyLink(db, who.userId, crew.phone)) {
      return c.json({
        data: await crewDetail(c, who, crew.phone),
        meta: { outcome: 'alreadyInList' },
      })
    }
    if ((await addBudget(c, who)) <= 0) {
      throw new LaborHttpError(
        429,
        'LINK_RATE_LIMITED',
        'Too many crews added today — try tomorrow',
      )
    }
    const created = await ensureCrew(db, crew, who.userId)
    const existing = created ? null : await db.crew.findUnique({ where: { phone: crew.phone } })
    await createLink(db, {
      tenantUserId: who.userId,
      tenantId: who.tenantId,
      crewPhone: crew.phone,
      nickname: nickname ?? (existing && existing.name !== crew.name ? crew.name : null),
    })
    return c.json(
      {
        data: await crewDetail(c, who, crew.phone),
        meta: { outcome: created ? 'added' : 'linkedExisting' },
      },
      201,
    )
  }),
)

const ImportBody = z.object({
  crews: z
    .array(z.object({ phone: z.string(), name: z.string(), email: z.string().nullish() }))
    .min(1)
    .max(MAX_IMPORT_ROWS),
})

type ImportOutcome = 'added' | 'linkedExisting' | 'alreadyInList' | 'invalid' | 'rateLimited'

// POST /crews/import { crews: [{ phone, name, email? }] } — the phone-contacts
// import. One result per row, in order; a bad row never fails the batch. The
// contact's name becomes my nickname when it differs from an existing crew's.
laborHandler.post('/crews/import', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const { crews } = await readBody(c, ImportBody)
    const db = c.get('db')
    let budget = await addBudget(c, who)
    const mine = new Set((await listMyLinks(db, who.userId)).map((l) => l.crewPhone))

    const results: Array<{
      phone: string
      outcome: ImportOutcome
      code?: string
      error?: string
    }> = []
    const valid = crews.map((row) => {
      try {
        return validateCrew(row)
      } catch (err) {
        if (!(err instanceof DomainError)) throw err
        return err
      }
    })
    // One lookup for every existing crew's shared name, instead of one per row.
    const existingNames = await crewNames(
      db,
      valid.flatMap((v) => (v instanceof DomainError ? [] : [v.phone])),
    )

    for (const [i, crew] of valid.entries()) {
      if (crew instanceof DomainError) {
        results.push({
          phone: crews[i]!.phone,
          outcome: 'invalid',
          code: crew.code,
          error: crew.message,
        })
        continue
      }
      if (mine.has(crew.phone)) {
        results.push({ phone: crew.phone, outcome: 'alreadyInList' })
        continue
      }
      if (budget <= 0) {
        results.push({ phone: crew.phone, outcome: 'rateLimited' })
        continue
      }
      const created = await ensureCrew(db, crew, who.userId)
      // A crew created between the lookup and ensureCrew has no prefetched
      // name; it is then treated as having this row's name (no nickname).
      const sharedName = created ? crew.name : (existingNames.get(crew.phone) ?? crew.name)
      await createLink(db, {
        tenantUserId: who.userId,
        tenantId: who.tenantId,
        crewPhone: crew.phone,
        nickname: sharedName !== crew.name ? crew.name : null,
      })
      mine.add(crew.phone)
      budget--
      results.push({ phone: crew.phone, outcome: created ? 'added' : 'linkedExisting' })
    }
    return c.json({ data: results })
  }),
)

// GET /crews/:phone — header, service areas, packers, my rating, the average.
laborHandler.get('/crews/:phone', requirePermission(Actions.ReadLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    return c.json({ data: await crewDetail(c, who, phoneParam(c)) })
  }),
)

const PatchCrewBody = z.object({
  name: z.string().optional(),
  email: z.string().nullish(),
  nickname: z.string().nullish(),
})

// PATCH /crews/:phone { name?, email?, nickname? } — name and email are shared
// with every linked driver; nickname is mine.
laborHandler.patch('/crews/:phone', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const phone = phoneParam(c)
    const link = await requireLink(c, who, phone)
    const input = await readBody(c, PatchCrewBody)
    const db = c.get('db')

    if (input.name !== undefined || input.email !== undefined) {
      const shared = validateCrew({
        phone,
        name: input.name ?? link.crew.name,
        email: input.email === undefined ? link.crew.email : input.email,
      })
      await db.crew.update({
        where: { phone },
        data: { name: shared.name, email: shared.email ?? null, updatedByUserId: who.userId },
      })
    }
    if (input.nickname !== undefined) {
      await db.crewLink.update({
        where: { id: link.id },
        data: { nickname: normalizeNickname(input.nickname) },
      })
    }
    return c.json({ data: await crewDetail(c, who, phone) })
  }),
)

// DELETE /crews/:phone — remove the crew from MY list (and my rating). The
// crew itself stays for every other driver who has it.
laborHandler.delete('/crews/:phone', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const link = await requireLink(c, who, phoneParam(c))
    await c.get('db').crewLink.delete({ where: { id: link.id } })
    return c.body(null, 204)
  }),
)

const ServiceAreasBody = z.object({
  serviceAreas: z.array(z.object({ city: z.string(), region: z.string() })),
})

// PUT /crews/:phone/service-areas { serviceAreas: [{ city, region }] } —
// replaces the shared list. Each city is matched to the geo reference data for
// distance ranking; a city we don't know is kept, just not ranked.
laborHandler.put('/crews/:phone/service-areas', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const phone = phoneParam(c)
    await requireLink(c, who, phone)
    const areas = validateServiceAreas((await readBody(c, ServiceAreasBody)).serviceAreas)
    const db = c.get('db')
    const geo = await findCities(db, areas)
    try {
      await db.$transaction((tx) =>
        replaceServiceAreas(
          tx,
          phone,
          areas.map((a) => ({ ...a, geo: geo.get(`${a.region}|${a.cityKey}`) })),
          who.userId,
        ),
      )
    } catch (err) {
      // Two linked drivers saving at once: both deletes see the same rows, and
      // the second insert hits the unique index. Last writer loses, legibly.
      if (isUniqueViolation(err)) {
        throw new LaborHttpError(
          409,
          'SERVICE_AREAS_CONFLICT',
          'Someone else just changed these service areas — reload and try again',
        )
      }
      throw err
    }
    return c.json({ data: await crewDetail(c, who, phone) })
  }),
)

const PackerBody = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullish(),
  cidNumber: z.string().nullish(),
  cidIssuedOn: z.string().nullish(),
  phone: z.string().nullish(),
})

function packerDuplicate(): LaborHttpError {
  return new LaborHttpError(
    409,
    'PACKER_DUPLICATE',
    'This crew already has a packer with that last name and CID number or email',
  )
}

// POST /crews/:phone/packers — add a packer to the (shared) crew.
laborHandler.post('/crews/:phone/packers', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const phone = phoneParam(c)
    await requireLink(c, who, phone)
    const p = validatePacker(await readBody(c, PackerBody), todayIso())
    try {
      const row = await c.get('db').packer.create({
        data: {
          crewPhone: phone,
          ...p,
          cidIssuedOn: toDate(p.cidIssuedOn),
          createdByUserId: who.userId,
          updatedByUserId: who.userId,
        },
      })
      return c.json({ data: packerDto(row) }, 201)
    } catch (err) {
      if (isUniqueViolation(err)) throw packerDuplicate()
      throw err
    }
  }),
)

// PATCH /crews/:phone/packers/:id — fields omitted keep their value; null clears.
laborHandler.patch('/crews/:phone/packers/:id', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const phone = phoneParam(c)
    await requireLink(c, who, phone)
    const db = c.get('db')
    const existing = await db.packer.findFirst({
      where: { id: c.req.param('id') ?? '', crewPhone: phone },
    })
    if (!existing) throw new LaborHttpError(404, 'PACKER_NOT_FOUND', 'Packer not found')
    const input = await readBody(c, PackerBody.partial())
    const pick = <K extends keyof typeof input>(k: K, current: string | null) =>
      input[k] === undefined ? current : (input[k] as string | null)
    const p = validatePacker(
      {
        firstName: input.firstName ?? existing.firstName,
        lastName: input.lastName ?? existing.lastName,
        email: pick('email', existing.email),
        cidNumber: pick('cidNumber', existing.cidNumber),
        cidIssuedOn: pick('cidIssuedOn', dateOnly(existing.cidIssuedOn)),
        phone: pick('phone', existing.phone),
      },
      todayIso(),
    )
    try {
      const row = await db.packer.update({
        where: { id: existing.id },
        data: { ...p, cidIssuedOn: toDate(p.cidIssuedOn), updatedByUserId: who.userId },
      })
      return c.json({ data: packerDto(row) })
    } catch (err) {
      if (isUniqueViolation(err)) throw packerDuplicate()
      throw err
    }
  }),
)

// DELETE /crews/:phone/packers/:id
laborHandler.delete('/crews/:phone/packers/:id', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const phone = phoneParam(c)
    await requireLink(c, who, phone)
    const { count } = await c
      .get('db')
      .packer.deleteMany({ where: { id: c.req.param('id') ?? '', crewPhone: phone } })
    if (count === 0) throw new LaborHttpError(404, 'PACKER_NOT_FOUND', 'Packer not found')
    return c.body(null, 204)
  }),
)

const RatingBody = z.object({ stars: z.number(), comment: z.string().nullish() })

// PUT /crews/:phone/rating { stars, comment? } — my private rating.
laborHandler.put('/crews/:phone/rating', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const phone = phoneParam(c)
    const link = await requireLink(c, who, phone)
    const rating = validateRating(await readBody(c, RatingBody))
    await c.get('db').crewRating.upsert({
      where: { crewLinkId: link.id },
      create: { crewLinkId: link.id, ...rating },
      update: rating,
    })
    return c.json({ data: await crewDetail(c, who, phone) })
  }),
)

// DELETE /crews/:phone/rating
laborHandler.delete('/crews/:phone/rating', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const phone = phoneParam(c)
    const link = await requireLink(c, who, phone)
    await c.get('db').crewRating.deleteMany({ where: { crewLinkId: link.id } })
    return c.json({ data: await crewDetail(c, who, phone) })
  }),
)

// GET /places?q= — city typeahead (US + Canada) for the service-area editor.
// "spring" or "spring, mo"; at least two letters.
laborHandler.get('/places', requirePermission(Actions.ReadLabor), (c) =>
  guarded(c, async () => {
    caller(c)
    const raw = c.req.query('q') ?? ''
    const [namePart = '', regionPart] = raw.split(',')
    const prefix = foldKey(namePart)
    if (prefix.length < 2) return c.json({ data: [] })
    const region = regionPart?.trim().toUpperCase() || undefined
    const rows = await searchCities(c.get('db'), prefix, region, PLACES_LIMIT)
    return c.json({
      data: rows.map((r) => ({ city: r.name, region: r.region, country: r.country })),
    })
  }),
)

// GET /export — my whole list, for the app to render as .vcf / .csv.
laborHandler.get('/export', requirePermission(Actions.ReadLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const db = c.get('db')
    const links = await listMyLinks(db, who.userId)
    const packers = await db.packer.findMany({
      where: { crewPhone: { in: links.map((l) => l.crewPhone) } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    })
    const byCrew = new Map<string, Packer[]>()
    for (const p of packers) byCrew.set(p.crewPhone, [...(byCrew.get(p.crewPhone) ?? []), p])
    const data: ExportCrew[] = links
      .map((l) => ({
        phone: l.crew.phone,
        name: l.crew.name,
        nickname: l.nickname,
        email: l.crew.email,
        serviceAreas: l.crew.serviceAreas.map((a) => ({ city: a.city, region: a.region })),
        myStars: l.rating?.stars ?? null,
        myComment: l.rating?.comment ?? null,
        packers: (byCrew.get(l.crewPhone) ?? []).map((p) => ({
          firstName: p.firstName,
          lastName: p.lastName,
          email: p.email,
          phone: p.phone,
          cidNumber: p.cidNumber,
          cidIssuedOn: dateOnly(p.cidIssuedOn),
        })),
      }))
      .sort((a, b) => (a.nickname ?? a.name).localeCompare(b.nickname ?? b.name))
    return c.json({ data })
  }),
)
