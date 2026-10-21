// ---------------------------------------------------------------------------
// Labor — persistence for crews, the per-driver links, service areas, packers,
// ratings, and the geo reference tables.
//
// None of these models are tenant-scoped (they are platform-wide by design —
// see the schema's Labor section), so the tenant client passes them straight
// through. Isolation is the caller's link: every crew read here is either
// keyed by a link the handler already resolved for the caller, or filtered on
// `tenantUserId`. Access decisions are made in handlers/labor.ts.
// ---------------------------------------------------------------------------

import type { Prisma, PrismaClient } from '@prisma/client'
import type { NormalizedServiceArea } from '@pegasus/domain'

type Db = PrismaClient | Prisma.TransactionClient

export const LINK_INCLUDE = {
  rating: true,
  crew: {
    include: {
      serviceAreas: { orderBy: [{ region: 'asc' }, { city: 'asc' }] },
      _count: { select: { packers: true } },
    },
  },
} as const satisfies Prisma.CrewLinkInclude

export type CrewLinkRow = Prisma.CrewLinkGetPayload<{ include: typeof LINK_INCLUDE }>

/** The caller's link to the crew at `phone`, or null when they haven't added it. */
export function findMyLink(db: Db, tenantUserId: string, phone: string) {
  return db.crewLink.findUnique({
    where: { tenantUserId_crewPhone: { tenantUserId, crewPhone: phone } },
    include: LINK_INCLUDE,
  })
}

export function listMyLinks(db: Db, tenantUserId: string) {
  return db.crewLink.findMany({ where: { tenantUserId }, include: LINK_INCLUDE })
}

/** How many crews the caller has added since `since` (the add rate limit). */
/** Links the user has CREATED since `since` — from the append-only add log, so removals don't count back. */
export function countLinksSince(db: Db, tenantUserId: string, since: Date) {
  return db.crewLinkAdd.count({ where: { tenantUserId, createdAt: { gte: since } } })
}

/** Every driver's stars for each of `phones` — the input to the anonymous aggregate. */
export async function starsByCrew(
  db: Db,
  phones: readonly string[],
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>()
  if (phones.length === 0) return out
  const rows = await db.crewRating.findMany({
    where: { link: { crewPhone: { in: [...phones] } } },
    select: { stars: true, link: { select: { crewPhone: true } } },
  })
  for (const r of rows) {
    const list = out.get(r.link.crewPhone) ?? []
    list.push(r.stars)
    out.set(r.link.crewPhone, list)
  }
  return out
}

/**
 * Creates the crew if no one has added this phone yet — an existing crew's
 * shared fields are left alone (the first driver's name stands). Returns
 * whether it was created. `ON CONFLICT DO NOTHING`, so two drivers adding the
 * same new number at once never fail: the second simply links to the row.
 */
export async function ensureCrew(
  db: Db,
  crew: { phone: string; name: string; email: string | undefined },
  userId: string,
): Promise<boolean> {
  const { count } = await db.crew.createMany({
    data: [
      {
        phone: crew.phone,
        name: crew.name,
        email: crew.email ?? null,
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    ],
    skipDuplicates: true,
  })
  return count === 1
}

/**
 * Links the caller to a crew. Returns false when they already had it — the
 * unique (tenantUserId, crewPhone) makes a double add a no-op, not an error.
 */
export async function createLink(
  db: Db,
  link: { tenantUserId: string; tenantId: string; crewPhone: string; nickname: string | null },
): Promise<boolean> {
  const { count } = await db.crewLink.createMany({ data: [link], skipDuplicates: true })
  if (count === 1) {
    await db.crewLinkAdd.create({
      data: { tenantUserId: link.tenantUserId, crewPhone: link.crewPhone },
    })
  }
  return count === 1
}

/** The shared names of whichever of `phones` already exist. */
export async function crewNames(db: Db, phones: readonly string[]): Promise<Map<string, string>> {
  if (phones.length === 0) return new Map()
  const rows = await db.crew.findMany({
    where: { phone: { in: [...phones] } },
    select: { phone: true, name: true },
  })
  return new Map(rows.map((r) => [r.phone, r.name]))
}

export function listPackers(db: Db, crewPhone: string) {
  return db.packer.findMany({
    where: { crewPhone },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })
}

/** Replaces a crew's service areas, copying each matched city's coordinates. */
export async function replaceServiceAreas(
  db: Db,
  crewPhone: string,
  areas: ReadonlyArray<NormalizedServiceArea & { geo: GeoMatch | undefined }>,
  userId: string,
) {
  await db.crewServiceArea.deleteMany({ where: { crewPhone } })
  if (areas.length) {
    await db.crewServiceArea.createMany({
      data: areas.map((a) => ({
        crewPhone,
        city: a.city,
        cityKey: a.cityKey,
        region: a.region,
        country: a.country,
        geoCityId: a.geo?.id ?? null,
        lat: a.geo?.lat ?? null,
        lon: a.geo?.lon ?? null,
        createdByUserId: userId,
      })),
    })
  }
  await db.crew.update({ where: { phone: crewPhone }, data: { updatedByUserId: userId } })
}

// ---------------------------------------------------------------------------
// Geo reference data
// ---------------------------------------------------------------------------

export interface GeoMatch {
  id: string
  name: string
  region: string
  country: string
  lat: number
  lon: number
}

const GEO_SELECT = {
  id: true,
  name: true,
  region: true,
  country: true,
  lat: true,
  lon: true,
} as const

/**
 * The most populous city named `nameKey` (optionally in `region`) — what a
 * typed city or a service area resolves to.
 */
export function findCity(db: Db, nameKey: string, region?: string) {
  return db.geoCity.findFirst({
    where: { nameKey, ...(region ? { region } : {}) },
    orderBy: { population: { sort: 'desc', nulls: 'last' } },
    select: GEO_SELECT,
  })
}

/** Resolves many (region, cityKey) pairs at once; keyed `REGION|cityKey`. */
export async function findCities(
  db: Db,
  pairs: ReadonlyArray<{ region: string; cityKey: string }>,
): Promise<Map<string, GeoMatch>> {
  const out = new Map<string, GeoMatch>()
  if (pairs.length === 0) return out
  const rows = await db.geoCity.findMany({
    where: { OR: pairs.map((p) => ({ region: p.region, nameKey: p.cityKey })) },
    orderBy: { population: { sort: 'desc', nulls: 'last' } },
    select: { ...GEO_SELECT, nameKey: true },
  })
  for (const r of rows) {
    const key = `${r.region}|${r.nameKey}`
    if (!out.has(key)) out.set(key, r) // rows are most-populous first
  }
  return out
}

export function findPostalCode(db: Db, country: string, code: string) {
  return db.geoPostalCode.findUnique({ where: { country_code: { country, code } } })
}

/** City typeahead: name-prefix matches, most populous first. */
export function searchCities(db: Db, prefix: string, region: string | undefined, limit: number) {
  return db.geoCity.findMany({
    where: { nameKey: { startsWith: prefix }, ...(region ? { region } : {}) },
    orderBy: [{ population: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
    take: limit,
    select: GEO_SELECT,
  })
}
