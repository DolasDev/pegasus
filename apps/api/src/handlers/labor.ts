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
// The COMPANY LIST (/company/crews) is the tenant's own link set: a crew on it
// is reachable by every user of the tenant as if it were in their book —
// detail, shared edits, service areas, packers — except the private extras
// (nickname, rating), which still need their own link. Anyone may add a crew
// from their own book; creating one onto the list by phone, and removing one,
// is for an Operations role (OPERATIONS_ROLES, checked here — not Cedar, like
// the longhaul reads).
//
// Mounted on the Cognito-only tenant router; the handler also refuses an
// `apiClient` caller. Cedar grants Read/WriteLabor to every principal
// (56-labor-shared.cedar); the only role gate is the Operations one above.
// Plans: plans/completed/e57eb0c4-labor-crews.md, plans/completed/a2f87151-company-labor.md.
// ---------------------------------------------------------------------------

import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { Prisma, type DriverCrewMember, type Packer } from '@prisma/client'
import {
  DomainError,
  aggregateRating,
  foldKey,
  formatPhoneNumber,
  normalizeNickname,
  normalizePhoneNumber,
  parseLocationQuery,
  rankCrewsByDistance,
  MAX_CREW_MEMBERS,
  validateActivityLabor,
  validateActivityMembers,
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
  createCompanyLink,
  createLink,
  ensureCrew,
  findCities,
  findCity,
  findCompanyLink,
  findMyLink,
  findPostalCode,
  listCompanyLinkExtras,
  listCompanyLinks,
  listMyLinkExtras,
  listMyLinks,
  listPackers,
  recordLinkAdd,
  replaceServiceAreas,
  crewNames,
  searchCities,
  starsByCrew,
  type CompanyCrewLinkRow,
  type CrewLinkRow,
  type CrewRow,
} from '../repositories/labor.repository'
import { legacyConnectionString } from '../lib/chat-access'
import { hasOperationsRole, resolveLonghaulReadScope } from '../lib/longhaul-read-scope'
import {
  activityById,
  activityOwnerDriverId,
  orderActivities,
  realDriverId,
  type DriverActivityRow,
} from '../lib/longhaul-driver-activity'
import { logger } from '../lib/logger'

/** New crews a user may add per rolling 24 hours. */
export const LINK_RATE_LIMIT = 100
const RATE_WINDOW_MS = 24 * 60 * 60_000
export const MAX_IMPORT_ROWS = 200
const PLACES_LIMIT = 20

type C = Context<AppEnv>

class LaborHttpError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422 | 429 | 503,
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
  /** Holds an Operations role — may create onto and remove from the company list. */
  operations: boolean
}

function caller(c: C): Caller {
  if (c.get('apiClient')) {
    throw new LaborHttpError(403, 'LABOR_HUMANS_ONLY', 'Labor is for signed-in users only')
  }
  const userId = c.get('userId')
  if (!userId) throw new LaborHttpError(403, 'USER_NOT_FOUND', 'No user record for this login')
  return {
    userId,
    tenantId: c.get('tenantId'),
    operations: hasOperationsRole(c.get('principal')?.roleNames ?? []),
  }
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

/**
 * A crew as the caller reaches it: through their own link, their tenant's
 * company list, or both. `crew` is the shared record either way.
 */
interface CrewView {
  crew: CrewRow
  link: Pick<CrewLinkRow, 'id' | 'nickname' | 'rating' | 'createdAt'> | null
  company: Pick<CompanyCrewLinkRow, 'id' | 'nickname' | 'createdAt'> | null
}

/** The crew at `phone` if it is in the caller's book or on their company list. */
async function requireCrewAccess(c: C, who: Caller, phone: string): Promise<CrewView> {
  const db = c.get('db')
  const [link, company] = await Promise.all([
    findMyLink(db, who.userId, phone),
    findCompanyLink(db, who.tenantId, phone),
  ])
  const crew = link?.crew ?? company?.crew
  if (!crew) throw new LaborHttpError(404, 'CREW_NOT_FOUND', 'Crew not in your list')
  return { crew, link, company }
}

/**
 * Every crew in the caller's book (`mine`) or on their company list
 * (`company`). The other list is read only for its per-crew extras.
 */
async function listViews(c: C, who: Caller, scope: 'mine' | 'company'): Promise<CrewView[]> {
  const db = c.get('db')
  if (scope === 'mine') {
    const [mine, company] = await Promise.all([
      listMyLinks(db, who.userId),
      listCompanyLinkExtras(db, who.tenantId),
    ])
    const companyBy = new Map(company.map((l) => [l.crewPhone, l]))
    return mine.map((l) => ({ crew: l.crew, link: l, company: companyBy.get(l.crewPhone) ?? null }))
  }
  const [mine, company] = await Promise.all([
    listMyLinkExtras(db, who.userId),
    listCompanyLinks(db, who.tenantId),
  ])
  const myBy = new Map(mine.map((l) => [l.crewPhone, l]))
  return company.map((l) => ({ crew: l.crew, link: myBy.get(l.crewPhone) ?? null, company: l }))
}

function notInYourList(): LaborHttpError {
  return new LaborHttpError(422, 'CREW_NOT_IN_YOUR_LIST', 'Add the crew to your list first')
}

function operationsOnly(who: Caller, what: string): void {
  if (!who.operations) {
    throw new LaborHttpError(403, 'OPERATIONS_ONLY', `Only Operations can ${what}`)
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

function crewDto(view: CrewView, stars: readonly number[] | undefined, who: Caller) {
  const { crew, link, company } = view
  const rating = link?.rating ?? null
  const nickname = link?.nickname ?? null
  const companyNickname = company?.nickname ?? null
  return {
    phone: crew.phone,
    phoneDisplay: formatPhoneNumber(crew.phone),
    name: crew.name,
    nickname,
    companyNickname,
    displayName: nickname ?? companyNickname ?? crew.name,
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
    addedAt: (link ?? company)!.createdAt.toISOString(),
    inMyList: link !== null,
    inCompanyList: company !== null,
    canRemoveFromCompany: company !== null && who.operations,
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

async function crewDtos(c: C, who: Caller, views: readonly CrewView[]): Promise<CrewDto[]> {
  const stars = await starsByCrew(
    c.get('db'),
    views.map((v) => v.crew.phone),
  )
  return views.map((v) => crewDto(v, stars.get(v.crew.phone), who))
}

/** The crew at `phone` as the caller sees it, with its packers. */
async function crewDetail(c: C, who: Caller, phone: string) {
  const view = await requireCrewAccess(c, who, phone)
  const [[dto], packers] = await Promise.all([
    crewDtos(c, who, [view]),
    listPackers(c.get('db'), phone),
  ])
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
      [crew.name, crew.nickname, crew.companyNickname].some((n) =>
        foldKey(n ?? '').includes(key),
      )) ||
    (digits.length >= 3 && crew.phone.includes(digits))
  )
}

/** Nearest first from `origin`, on the stored service-area coordinates. */
function rankFrom(views: readonly CrewView[], dtos: readonly CrewDto[], origin: SearchLocation) {
  const areas = new Map(views.map((v) => [v.crew.phone, v.crew.serviceAreas]))
  return rankCrewsByDistance(
    dtos.map((dto) => ({ dto, name: dto.displayName, serviceAreas: areas.get(dto.phone) ?? [] })),
    origin,
  ).map((r) => ({ ...r.dto, distanceMiles: r.distanceMiles }))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const laborHandler = new Hono<AppEnv>()

/**
 * The search both lists share. Empty q: A–Z. A ZIP, postal code or "City, ST":
 * nearest first. A state/province: crews serving it, A–Z. Other text: crews
 * whose name, nickname or phone matches — or, when none do and the text is a
 * city name, nearest first from that city.
 */
async function searchViews(c: C, who: Caller, views: readonly CrewView[]) {
  const db = c.get('db')
  const crews = await crewDtos(c, who, views)
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
      return origin ? list(rankFrom(views, crews, origin), origin) : list([], null, true)
    }
    case 'text': {
      const hits = crews.filter((cr) => matchesText(cr, query.text))
      if (hits.length) return list(hits.sort(byName), null)
      const city = await findCity(db, foldKey(query.text))
      if (!city) return list([], null)
      const origin = { lat: city.lat, lon: city.lon, label: `${city.name}, ${city.region}` }
      return list(rankFrom(views, crews, origin), origin)
    }
  }
}

// GET /crews?q= — my crews (searchViews has the query rules).
laborHandler.get('/crews', requirePermission(Actions.ReadLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    return searchViews(c, who, await listViews(c, who, 'mine'))
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

/** Writes the shared name/email when either is in the body. */
async function updateSharedHeader(
  c: C,
  who: Caller,
  crew: CrewRow,
  input: { name?: string | undefined; email?: string | null | undefined },
) {
  if (input.name === undefined && input.email === undefined) return
  const shared = validateCrew({
    phone: crew.phone,
    name: input.name ?? crew.name,
    email: input.email === undefined ? crew.email : input.email,
  })
  await c.get('db').crew.update({
    where: { phone: crew.phone },
    data: { name: shared.name, email: shared.email ?? null, updatedByUserId: who.userId },
  })
}

// PATCH /crews/:phone { name?, email?, nickname? } — name and email are shared
// with every linked driver and company list; nickname is mine, so it needs the
// crew in my own book.
laborHandler.patch('/crews/:phone', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const phone = phoneParam(c)
    const { crew, link } = await requireCrewAccess(c, who, phone)
    const input = await readBody(c, PatchCrewBody)
    // A private nickname needs my own link; clearing one I don't have is a no-op.
    if (input.nickname != null && !link) throw notInYourList()
    const db = c.get('db')

    await updateSharedHeader(c, who, crew, input)
    if (input.nickname !== undefined && link) {
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

// PUT /crews/:phone/service-areas { serviceAreas: [{ city, region }] } — any
// crew the caller can reach (own book or company list);
// replaces the shared list. Each city is matched to the geo reference data for
// distance ranking; a city we don't know is kept, just not ranked.
laborHandler.put('/crews/:phone/service-areas', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const phone = phoneParam(c)
    await requireCrewAccess(c, who, phone)
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

// The service-area and packer routes take any crew the caller can reach — their
// own book or the company list (drivers edit company crews like their own).

// POST /crews/:phone/packers — add a packer to the (shared) crew.
laborHandler.post('/crews/:phone/packers', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const phone = phoneParam(c)
    await requireCrewAccess(c, who, phone)
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
    await requireCrewAccess(c, who, phone)
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
    await requireCrewAccess(c, who, phone)
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

// ---------------------------------------------------------------------------
// Company list — the tenant's shared crews. Reading, adding from your own book
// and editing are for everyone at the tenant; creating a crew onto the list by
// phone and removing one are Operations-only. Removing never deletes the crew.
// ---------------------------------------------------------------------------

// GET /company/crews?q= — the company list, with the same search as /crews.
laborHandler.get('/company/crews', requirePermission(Actions.ReadLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    return searchViews(c, who, await listViews(c, who, 'company'))
  }),
)

const AddCompanyCrewBody = z.object({
  phone: z.string(),
  name: z.string().optional(),
  email: z.string().nullish(),
  nickname: z.string().nullish(),
})

type CompanyAddOutcome = 'added' | 'addedFromMyList' | 'linkedExisting'

// POST /company/crews { phone, name?, email?, nickname? } — put a crew on the
// company list. A crew in my own book goes on as-is (the "Add to company list"
// button). Otherwise only Operations may add it, by phone + name like
// POST /crews: an existing crew is linked (its shared name stands; mine
// becomes the company nickname when it differs). That path spends the caller's
// add budget, so the company list is no way around the rate limit. Idempotent.
laborHandler.post('/company/crews', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const input = await readBody(c, AddCompanyCrewBody)
    const phone = normalizePhoneNumber(input.phone)
    const db = c.get('db')
    const alreadyInList = async () =>
      c.json({ data: await crewDetail(c, who, phone), meta: { outcome: 'alreadyInList' } })

    if (await findCompanyLink(db, who.tenantId, phone)) return alreadyInList()

    let outcome: CompanyAddOutcome
    let nickname = normalizeNickname(input.nickname)
    if (await findMyLink(db, who.userId, phone)) {
      outcome = 'addedFromMyList'
    } else {
      if (!who.operations) throw notInYourList()
      const crew = validateCrew({ phone, name: input.name ?? '', email: input.email })
      if ((await addBudget(c, who)) <= 0) {
        throw new LaborHttpError(
          429,
          'LINK_RATE_LIMITED',
          'Too many crews added today — try tomorrow',
        )
      }
      const created = await ensureCrew(db, crew, who.userId)
      if (!created) {
        const existing = await db.crew.findUnique({ where: { phone: crew.phone } })
        if (existing && existing.name !== crew.name) nickname ??= crew.name
      }
      outcome = created ? 'added' : 'linkedExisting'
    }
    const added = await createCompanyLink(db, {
      tenantId: who.tenantId,
      crewPhone: phone,
      nickname,
      addedByUserId: who.userId,
    })
    // A concurrent add won the race.
    if (!added) return alreadyInList()
    // An Operations add by phone spends the budget — only once it linked something.
    if (outcome !== 'addedFromMyList') await recordLinkAdd(db, who.userId, phone)
    return c.json({ data: await crewDetail(c, who, phone), meta: { outcome } }, 201)
  }),
)

// PATCH /company/crews/:phone { name?, email?, nickname? } — name and email
// are the crew's shared fields; nickname is the company display name.
laborHandler.patch('/company/crews/:phone', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const phone = phoneParam(c)
    const company = await findCompanyLink(c.get('db'), who.tenantId, phone)
    if (!company) throw new LaborHttpError(404, 'CREW_NOT_FOUND', 'Crew not on the company list')
    const input = await readBody(c, PatchCrewBody)
    await updateSharedHeader(c, who, company.crew, input)
    if (input.nickname !== undefined) {
      await c.get('db').companyCrewLink.update({
        where: { id: company.id },
        data: { nickname: normalizeNickname(input.nickname) },
      })
    }
    return c.json({ data: await crewDetail(c, who, phone) })
  }),
)

// DELETE /company/crews/:phone — Operations only. Takes the crew off the
// company list; the crew, every driver's own link to it and past activity
// labor all stay.
laborHandler.delete('/company/crews/:phone', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    operationsOnly(who, 'remove a crew from the company list')
    const { count } = await c.get('db').companyCrewLink.deleteMany({
      where: { tenantId: who.tenantId, crewPhone: phoneParam(c) },
    })
    if (count === 0) {
      throw new LaborHttpError(404, 'CREW_NOT_FOUND', 'Crew not on the company list')
    }
    return c.body(null, 204)
  }),
)

// ---------------------------------------------------------------------------
// My Crew — the caller's own packers (DriverCrewMember), private to their login:
// no shared Crew stands behind them, so nobody else reads or edits them. A
// member flagged `everyJob` is added to the driver's labor activities when
// dispatch accepts one of their trips (lib/labor-auto-assign.ts). Removal is
// soft: a removed member leaves the list and is never assigned again, but stays
// on the jobs they worked. Adding someone whose identity key (last name + CID
// number or email) matches a removed member brings that member back.
// Plan: plans/in-progress/my-crew.md.
// ---------------------------------------------------------------------------

function memberDto(m: DriverCrewMember) {
  return {
    id: m.id,
    firstName: m.firstName,
    lastName: m.lastName,
    email: m.email,
    cidNumber: m.cidNumber,
    cidIssuedOn: dateOnly(m.cidIssuedOn),
    phone: m.phone,
    phoneDisplay: m.phone ? formatPhoneNumber(m.phone) : null,
    everyJob: m.everyJob,
    updatedAt: m.updatedAt.toISOString(),
  }
}

const MemberBody = PackerBody.extend({ everyJob: z.boolean().optional() })

function memberDuplicate(): LaborHttpError {
  return new LaborHttpError(
    409,
    'MEMBER_DUPLICATE',
    'Your crew already has someone with that last name and CID number or email',
  )
}

async function requireMember(c: C, who: Caller): Promise<DriverCrewMember> {
  const member = await c.get('db').driverCrewMember.findFirst({
    where: { id: c.req.param('id') ?? '', tenantUserId: who.userId, removedAt: null },
  })
  if (!member) throw new LaborHttpError(404, 'MEMBER_NOT_FOUND', 'Not in your crew')
  return member
}

// GET /my-crew — my members, A–Z by last name.
laborHandler.get('/my-crew', requirePermission(Actions.ReadLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const rows = await c.get('db').driverCrewMember.findMany({
      where: { tenantUserId: who.userId, removedAt: null },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    })
    return c.json({ data: rows.map(memberDto) })
  }),
)

// POST /my-crew — add a member (or bring back a removed one with the same key).
laborHandler.post('/my-crew', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const body = await readBody(c, MemberBody)
    const p = validatePacker(body, todayIso())
    const db = c.get('db')
    const active = await db.driverCrewMember.count({
      where: { tenantUserId: who.userId, removedAt: null },
    })
    if (active >= MAX_CREW_MEMBERS) {
      throw new LaborHttpError(
        422,
        'MY_CREW_FULL',
        `Your crew can have at most ${MAX_CREW_MEMBERS} people`,
      )
    }
    const keys = [
      ...(p.cidKey ? [{ cidKey: p.cidKey }] : []),
      ...(p.emailKey ? [{ emailKey: p.emailKey }] : []),
    ]
    const removed = keys.length
      ? await db.driverCrewMember.findFirst({
          where: { tenantUserId: who.userId, removedAt: { not: null }, OR: keys },
        })
      : null
    const data = { ...p, cidIssuedOn: toDate(p.cidIssuedOn), everyJob: body.everyJob ?? false }
    try {
      const row = removed
        ? await db.driverCrewMember.update({
            where: { id: removed.id },
            data: { ...data, removedAt: null },
          })
        : await db.driverCrewMember.create({
            data: { tenantId: who.tenantId, tenantUserId: who.userId, ...data },
          })
      return c.json({ data: memberDto(row) }, 201)
    } catch (err) {
      if (isUniqueViolation(err)) throw memberDuplicate()
      throw err
    }
  }),
)

// PATCH /my-crew/:id — fields omitted keep their value; null clears.
laborHandler.patch('/my-crew/:id', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const existing = await requireMember(c, who)
    const input = await readBody(c, MemberBody.partial())
    const pick = (k: 'email' | 'cidNumber' | 'phone', current: string | null) =>
      input[k] === undefined ? current : (input[k] ?? null)
    const p = validatePacker(
      {
        firstName: input.firstName ?? existing.firstName,
        lastName: input.lastName ?? existing.lastName,
        email: pick('email', existing.email),
        cidNumber: pick('cidNumber', existing.cidNumber),
        cidIssuedOn:
          input.cidIssuedOn === undefined
            ? dateOnly(existing.cidIssuedOn)
            : (input.cidIssuedOn ?? null),
        phone: pick('phone', existing.phone),
      },
      todayIso(),
    )
    try {
      const row = await c.get('db').driverCrewMember.update({
        where: { id: existing.id },
        data: {
          ...p,
          cidIssuedOn: toDate(p.cidIssuedOn),
          everyJob: input.everyJob ?? existing.everyJob,
        },
      })
      return c.json({ data: memberDto(row) })
    } catch (err) {
      if (isUniqueViolation(err)) throw memberDuplicate()
      throw err
    }
  }),
)

// DELETE /my-crew/:id — soft: off the list and out of the auto-assign, but the
// jobs they worked keep them.
laborHandler.delete('/my-crew/:id', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const { count } = await c.get('db').driverCrewMember.updateMany({
      where: { id: c.req.param('id') ?? '', tenantUserId: who.userId, removedAt: null },
      data: { removedAt: new Date(), everyJob: false },
    })
    if (count === 0) throw new LaborHttpError(404, 'MEMBER_NOT_FOUND', 'Not in your crew')
    return c.body(null, 204)
  }),
)

// ---------------------------------------------------------------------------
// Activity labor — which crews (and which of their packers) worked each of a
// driver's activities on an order. Unlike the book, this is tenant data: the
// activity is a row in the tenant's legacy database. A driver sees and edits
// only the activities they own (the ETA editor's rule — lib/longhaul-driver-
// activity); an Operations role (lib/longhaul-read-scope) sees every activity on the
// order, editable only where its own driver mapping owns one.
// Plan: plans/completed/6f6b7bf6-activity-labor.md.
// ---------------------------------------------------------------------------

/** The caller's longhaul driver id (null when the login maps to none). */
async function myDriverId(c: C, who: Caller): Promise<number | null> {
  // TenantUser is not auto-scoped by the tenant client — name the tenant.
  const user = await c.get('db').tenantUser.findFirst({
    where: { id: who.userId, tenantId: who.tenantId },
    select: { longhaulDriverId: true },
  })
  return realDriverId(user?.longhaulDriverId)
}

const driverNotMapped = () =>
  new LaborHttpError(
    403,
    'DRIVER_NOT_MAPPED',
    'This login is not linked to a driver. Ask a tenant administrator to set the driver on the Users settings page.',
  )

/** Runs a legacy read, failing closed: no connection or any error is a 503. */
async function legacy<T>(c: C, who: Caller, read: (cs: string) => Promise<T>): Promise<T> {
  const cs = await legacyConnectionString(who.tenantId)
  if (cs) {
    try {
      return await read(cs)
    } catch (err) {
      logger.warn('labor legacy activity read failed', {
        error: String(err),
        correlationId: c.get('correlationId'),
      })
    }
  }
  throw new LaborHttpError(503, 'LEGACY_UNAVAILABLE', 'The order database is unavailable')
}

function intParam(c: C, name: string): number {
  const n = Number(c.req.param(name))
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new LaborHttpError(400, 'VALIDATION_ERROR', `Invalid ${name}`)
  }
  return n
}

/** A legacy date or datetime as its calendar day — the longhaul date-only contract. */
function legacyDay(value: Date | string | null): string | null {
  if (value == null || value === '') return null
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

/** The labor of `activities`, shaped for the Labor tab. */
async function activityLaborDtos(
  c: C,
  who: Caller,
  activities: readonly DriverActivityRow[],
  driverId: number | null,
) {
  const db = c.get('db')
  const assigned = await db.activityLaborCrew.findMany({
    where: { activityId: { in: activities.map((a) => a.id) } },
    include: {
      crew: { include: { packers: { orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] } } },
      packers: { select: { packerId: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  const phones = assigned.map((a) => a.crewPhone)
  const [links, company] = await Promise.all([
    db.crewLink.findMany({
      where: { tenantUserId: who.userId, crewPhone: { in: phones } },
      select: { crewPhone: true, nickname: true },
    }),
    db.companyCrewLink.findMany({
      where: { tenantId: who.tenantId, crewPhone: { in: phones } },
      select: { crewPhone: true, nickname: true },
    }),
  ])
  const nicknames = new Map(links.map((l) => [l.crewPhone, l.nickname]))
  const companyNicknames = new Map(company.map((l) => [l.crewPhone, l.nickname]))
  const owns = (a: DriverActivityRow) => driverId != null && activityOwnerDriverId(a) === driverId
  const anyEditable = activities.some(owns)
  const [members, myCrew] = await Promise.all([
    db.activityLaborMember.findMany({
      where: { activityId: { in: activities.map((a) => a.id) } },
      include: { member: true },
    }),
    anyEditable
      ? db.driverCrewMember.findMany({
          where: { tenantUserId: who.userId, removedAt: null },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        })
      : Promise.resolve([]),
  ])
  const memberRow = (m: DriverCrewMember, selected: boolean) => ({
    id: m.id,
    firstName: m.firstName,
    lastName: m.lastName,
    phoneDisplay: m.phone ? formatPhoneNumber(m.phone) : null,
    everyJob: m.everyJob && m.removedAt === null,
    // In my crew now — the only members that may be newly ticked.
    mine: m.tenantUserId === who.userId && m.removedAt === null,
    selected,
  })
  /** On an activity I own: my crew (ticked where assigned), then anyone else who worked it. */
  const membersOf = (activityId: number, editable: boolean) => {
    const worked = members.filter((x) => x.activityId === activityId).map((x) => x.member)
    const byName = (a: DriverCrewMember, b: DriverCrewMember) =>
      a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)
    if (!editable) return [...worked].sort(byName).map((m) => memberRow(m, true))
    const ids = new Set(worked.map((m) => m.id))
    const mine = new Set(myCrew.map((m) => m.id))
    return [
      ...myCrew.map((m) => memberRow(m, ids.has(m.id))),
      ...worked
        .filter((m) => !mine.has(m.id))
        .sort(byName)
        .map((m) => memberRow(m, true)),
    ]
  }
  return activities.map((a) => ({
    id: a.id,
    orderNum: a.order_num,
    typeCode: a.ActivityType_code?.trim() || null,
    typeName: a.activityType_name,
    typeAbbreviation: a.activityType_abbreviation?.trim() || null,
    plannedStart: legacyDay(a.planned_start),
    estimatedDate: legacyDay(a.estimated_date),
    actualDate: legacyDay(a.actual_date),
    editable: owns(a),
    myCrew: membersOf(a.id, owns(a)),
    crews: assigned
      .filter((x) => x.activityId === a.id)
      .map((x) => {
        const selected = new Set(x.packers.map((p) => p.packerId))
        const nickname = nicknames.get(x.crewPhone) ?? null
        return {
          phone: x.crew.phone,
          phoneDisplay: formatPhoneNumber(x.crew.phone),
          name: x.crew.name,
          nickname,
          displayName: nickname ?? companyNicknames.get(x.crewPhone) ?? x.crew.name,
          inMyBook: nicknames.has(x.crewPhone),
          inCompanyList: companyNicknames.has(x.crewPhone),
          packers: x.crew.packers.map((p) => ({
            id: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
            phoneDisplay: p.phone ? formatPhoneNumber(p.phone) : null,
            selected: selected.has(p.id),
          })),
        }
      }),
  }))
}

// GET /orders/:orderNum/activities — the order's activities the caller may see,
// each with its assigned crews and every packer of those crews (`selected` marks
// who worked it).
laborHandler.get('/orders/:orderNum/activities', requirePermission(Actions.ReadLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const orderNum = intParam(c, 'orderNum')
    // The longhaul driver-data read scope (PATTERNS): an Operations role reads
    // every activity; anyone else only those their driver mapping owns.
    const scope = await resolveLonghaulReadScope(c)
    if (scope.kind === 'none') throw driverNotMapped()
    const driverId = await myDriverId(c, who)
    const rows = await legacy(c, who, (cs) => orderActivities(cs, orderNum))
    const visible =
      scope.kind === 'all' ? rows : rows.filter((a) => activityOwnerDriverId(a) === scope.driverId)
    return c.json({ data: await activityLaborDtos(c, who, visible, driverId) })
  }),
)

const ActivityLaborBody = z.object({
  crews: z.array(z.object({ phone: z.string(), packerIds: z.array(z.string()) })),
  memberIds: z.array(z.string()).optional(),
})

// PUT /activities/:activityId { crews: [{ phone, packerIds }], memberIds? } —
// replaces the activity's whole labor set. Only the activity's own driver may
// write it. A crew newly added must be in the caller's book or on the company
// list; one already assigned may stay after it leaves both. Every packer must be
// on its crew. `memberIds` is My Crew: a member newly ticked must be in the
// caller's crew; one already on the activity may stay after removal. Omitting
// `memberIds` leaves the members alone — app builds from before My Crew send
// only crews and must not wipe what the trip-accepted auto-assign added.
laborHandler.put('/activities/:activityId', requirePermission(Actions.WriteLabor), (c) =>
  guarded(c, async () => {
    const who = caller(c)
    const activityId = intParam(c, 'activityId')
    const body = await readBody(c, ActivityLaborBody)
    const crews = validateActivityLabor(body.crews)
    const memberIds = body.memberIds && validateActivityMembers(body.memberIds)
    const driverId = await myDriverId(c, who)
    if (driverId == null) throw driverNotMapped()
    const activity = await legacy(c, who, (cs) => activityById(cs, activityId))
    if (!activity) throw new LaborHttpError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found')
    if (activityOwnerDriverId(activity) !== driverId) {
      throw new LaborHttpError(403, 'NOT_YOUR_ACTIVITY', 'This activity is not assigned to you')
    }

    const db = c.get('db')
    const existing = await db.activityLaborCrew.findMany({
      where: { activityId },
      select: { id: true, crewPhone: true },
    })
    const kept = new Set(existing.map((e) => e.crewPhone))
    const added = crews.map((x) => x.phone).filter((p) => !kept.has(p))
    if (added.length > 0) {
      const [mine, company] = await Promise.all([
        db.crewLink.findMany({
          where: { tenantUserId: who.userId, crewPhone: { in: added } },
          select: { crewPhone: true },
        }),
        db.companyCrewLink.findMany({
          where: { tenantId: who.tenantId, crewPhone: { in: added } },
          select: { crewPhone: true },
        }),
      ])
      const reachable = new Set([...mine, ...company].map((l) => l.crewPhone))
      if (added.some((p) => !reachable.has(p))) throw notInYourList()
    }
    const packers = await db.packer.findMany({
      where: { id: { in: crews.flatMap((x) => x.packerIds) } },
      select: { id: true, crewPhone: true },
    })
    const packerCrew = new Map(packers.map((p) => [p.id, p.crewPhone]))
    for (const x of crews) {
      if (x.packerIds.some((id) => packerCrew.get(id) !== x.phone)) {
        throw new LaborHttpError(422, 'PACKER_NOT_ON_CREW', 'A selected packer is not on that crew')
      }
    }
    let addedMembers: string[] = []
    if (memberIds) {
      const worked = await db.activityLaborMember.findMany({
        where: { activityId },
        select: { memberId: true },
      })
      const on = new Set(worked.map((w) => w.memberId))
      addedMembers = memberIds.filter((id) => !on.has(id))
      if (addedMembers.length > 0) {
        const mine = await db.driverCrewMember.count({
          where: { id: { in: addedMembers }, tenantUserId: who.userId, removedAt: null },
        })
        if (mine !== addedMembers.length) {
          throw new LaborHttpError(422, 'MEMBER_NOT_YOURS', 'Add them to your crew first')
        }
      }
    }

    try {
      await db.$transaction(async (tx) => {
        await tx.activityLaborCrew.deleteMany({
          where: { activityId, crewPhone: { notIn: crews.map((x) => x.phone) } },
        })
        const ids = new Map(existing.map((e) => [e.crewPhone, e.id]))
        for (const phone of added) {
          const row = await tx.activityLaborCrew.create({
            data: {
              tenantId: who.tenantId,
              activityId,
              orderNum: activity.order_num,
              crewPhone: phone,
              assignedByUserId: who.userId,
            },
            select: { id: true },
          })
          ids.set(phone, row.id)
        }
        await tx.activityLaborPacker.deleteMany({
          where: { activityLaborCrewId: { in: crews.map((x) => ids.get(x.phone)!) } },
        })
        await tx.activityLaborPacker.createMany({
          data: crews.flatMap((x) =>
            x.packerIds.map((packerId) => ({
              activityLaborCrewId: ids.get(x.phone)!,
              tenantId: who.tenantId,
              packerId,
            })),
          ),
        })
        if (memberIds) {
          await tx.activityLaborMember.deleteMany({
            where: { activityId, memberId: { notIn: memberIds } },
          })
          // skipDuplicates: the trip-accepted auto-assign may have added one meanwhile.
          await tx.activityLaborMember.createMany({
            data: addedMembers.map((memberId) => ({
              tenantId: who.tenantId,
              activityId,
              orderNum: activity.order_num,
              memberId,
              assignedByUserId: who.userId,
            })),
            skipDuplicates: true,
          })
        }
      })
    } catch (err) {
      // A concurrent save assigned the same crew first.
      if (isUniqueViolation(err)) {
        throw new LaborHttpError(
          409,
          'ACTIVITY_LABOR_CONFLICT',
          'Labor was changed at the same time — reload and try again',
        )
      }
      throw err
    }
    const [dto] = await activityLaborDtos(c, who, [activity], driverId)
    return c.json({ data: dto })
  }),
)
