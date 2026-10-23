// ---------------------------------------------------------------------------
// Labor bounded context
//
// A driver's private book of cash-labor crews — the local packers/loaders they
// hire at a stop. A crew is identified by its phone number (E.164) and is a
// platform-wide record: every driver who has added that phone number to their
// list sees and can edit the same crew (name, service areas, packers), while
// ratings, comments and nicknames stay private to each driver.
//
// These are the pure rules — phone normalisation, packer validation and
// identity, location-query parsing, nearest-first ranking, the anonymous rating
// aggregate, and the contacts export formats. Persistence, the per-driver link
// and geocoding live in the API layer. Plan: plans/in-progress/labor-crews.md.
// ---------------------------------------------------------------------------

import { DomainError } from '../shared/errors'
import { isValidE164 } from '../messaging/index'
import { haversineMiles } from '../rating/mileage'

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

/**
 * Normalises a phone number as typed or as stored in a phone's contacts to
 * E.164 — the crew's identity, so one crew has exactly one spelling.
 *
 * North American numbers (US + Canada share +1) are accepted in any common
 * format — `(404) 555-1212`, `404.555.1212`, `1-404-555-1212`, `+1 404 555 1212`
 * — and an extension (`x123`, `ext. 123`) is dropped. Other countries must be
 * written with a leading `+`.
 *
 * @throws {DomainError} `INVALID_PHONE_NUMBER`
 */
export function normalizePhoneNumber(raw: string): string {
  const withoutExt = raw.replace(/\s*(?:ext\.?|extension|x|#)\s*\d+\s*$/i, '').trim()
  const international = withoutExt.startsWith('+')
  const digits = withoutExt.replace(/\D/g, '')

  let nanp: string | undefined
  if (!international && digits.length === 10) nanp = digits
  else if (digits.length === 11 && digits.startsWith('1')) nanp = digits.slice(1)

  if (nanp !== undefined) {
    // NANP: area code and exchange both start 2–9.
    if (/^[2-9]\d{2}[2-9]\d{6}$/.test(nanp)) return `+1${nanp}`
  } else if (international && /^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) {
    // "+404 555 1212" — a US/Canadian number with the "1" left out. Taking it
    // as some other country's number would give the same crew a second
    // identity, so make the writer say which they meant.
    throw new DomainError(
      `Add the country code: +1 for the US and Canada (${raw})`,
      'INVALID_PHONE_NUMBER',
    )
  } else if (international && isValidE164(`+${digits}`)) {
    return `+${digits}`
  }
  throw new DomainError(`Not a valid phone number: ${raw}`, 'INVALID_PHONE_NUMBER')
}

/** `+14045551212` → `(404) 555-1212`; other numbers are returned unchanged. */
export function formatPhoneNumber(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Lowercased, accent-folded, whitespace-collapsed — the key names are matched on. */
export function foldKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function optionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function requiredText(value: string | null | undefined, field: string, max: number): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new DomainError(`${field} is required`, 'LABOR_FIELD_REQUIRED')
  if (trimmed.length > max) {
    throw new DomainError(`${field} must be at most ${max} characters`, 'LABOR_FIELD_TOO_LONG')
  }
  return trimmed
}

function optionalEmail(value: string | null | undefined): string | undefined {
  const email = optionalText(value)
  if (email === undefined) return undefined
  if (!EMAIL.test(email) || email.length > 254) {
    throw new DomainError(`Not a valid email address: ${email}`, 'INVALID_EMAIL')
  }
  return email.toLowerCase()
}

// ---------------------------------------------------------------------------
// Crews
// ---------------------------------------------------------------------------

export const MAX_CREW_NAME_LENGTH = 120
export const MAX_NICKNAME_LENGTH = 120

export interface CrewInput {
  phone: string
  name: string
  email?: string | null | undefined
}

export interface NormalizedCrew {
  phone: string
  name: string
  email: string | undefined
}

/** @throws {DomainError} `INVALID_PHONE_NUMBER`, `LABOR_FIELD_REQUIRED`, `INVALID_EMAIL` */
export function validateCrew(input: CrewInput): NormalizedCrew {
  return {
    phone: normalizePhoneNumber(input.phone),
    name: requiredText(input.name, 'Crew name', MAX_CREW_NAME_LENGTH),
    email: optionalEmail(input.email),
  }
}

/** A private nickname: trimmed, or `null` to clear it. */
export function normalizeNickname(value: string | null | undefined): string | null {
  const nickname = optionalText(value)
  if (nickname === undefined) return null
  if (nickname.length > MAX_NICKNAME_LENGTH) {
    throw new DomainError(
      `Nickname must be at most ${MAX_NICKNAME_LENGTH} characters`,
      'LABOR_FIELD_TOO_LONG',
    )
  }
  return nickname
}

// ---------------------------------------------------------------------------
// Packers
// ---------------------------------------------------------------------------

export interface PackerInput {
  firstName: string
  lastName: string
  email?: string | null | undefined
  cidNumber?: string | null | undefined
  /** Date the Candidate ID was issued, `YYYY-MM-DD`. Required iff `cidNumber`. */
  cidIssuedOn?: string | null | undefined
  phone?: string | null | undefined
}

export interface NormalizedPacker {
  firstName: string
  lastName: string
  email: string | null
  cidNumber: string | null
  cidIssuedOn: string | null
  phone: string | null
  /** Identity key `lastname|cid` — unique within a crew; null without a CID. */
  cidKey: string | null
  /** Identity key `lastname|email` — unique within a crew; null without an email. */
  emailKey: string | null
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function isRealDate(iso: string): boolean {
  const m = ISO_DATE.exec(iso)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toISOString().slice(0, 10) === iso
}

/**
 * Validates a packer. A packer needs a first and last name plus at least one of
 * email, CID number or phone. A CID number needs the date it was issued, which
 * can't be in the future (`today` is `YYYY-MM-DD`, supplied by the caller).
 *
 * A packer is identified within its crew by last name + CID number, or by last
 * name + email; the returned keys are what the store enforces uniqueness on. A
 * phone-only packer has no identity key.
 *
 * @throws {DomainError} `LABOR_FIELD_REQUIRED`, `PACKER_CONTACT_REQUIRED`,
 *   `PACKER_CID_DATE_REQUIRED`, `PACKER_CID_DATE_INVALID`, `INVALID_EMAIL`,
 *   `INVALID_PHONE_NUMBER`
 */
export function validatePacker(input: PackerInput, today: string): NormalizedPacker {
  const firstName = requiredText(input.firstName, 'First name', 80)
  const lastName = requiredText(input.lastName, 'Last name', 80)
  const email = optionalEmail(input.email) ?? null
  const cidNumber = optionalText(input.cidNumber)?.toUpperCase() ?? null
  if (cidNumber !== null && cidNumber.length > 40) {
    throw new DomainError('CID number must be at most 40 characters', 'LABOR_FIELD_TOO_LONG')
  }
  const rawPhone = optionalText(input.phone)
  const phone = rawPhone === undefined ? null : normalizePhoneNumber(rawPhone)

  if (email === null && cidNumber === null && phone === null) {
    throw new DomainError(
      'A packer needs an email, a CID number or a phone number',
      'PACKER_CONTACT_REQUIRED',
    )
  }

  const rawDate = optionalText(input.cidIssuedOn) ?? null
  let cidIssuedOn: string | null = null
  if (cidNumber !== null) {
    if (rawDate === null) {
      throw new DomainError('A CID number needs its issue date', 'PACKER_CID_DATE_REQUIRED')
    }
    if (!isRealDate(rawDate)) {
      throw new DomainError(`Not a valid date: ${rawDate}`, 'PACKER_CID_DATE_INVALID')
    }
    if (rawDate > today) {
      throw new DomainError('The CID issue date is in the future', 'PACKER_CID_DATE_INVALID')
    }
    cidIssuedOn = rawDate
  }
  // A date without a CID number is meaningless — drop it rather than reject.

  const lastKey = foldKey(lastName)
  return {
    firstName,
    lastName,
    email,
    cidNumber,
    cidIssuedOn,
    phone,
    cidKey: cidNumber === null ? null : `${lastKey}|${cidNumber}`,
    emailKey: email === null ? null : `${lastKey}|${email}`,
  }
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

export const MAX_RATING_COMMENT_LENGTH = 1000

/** Fewest raters before the anonymous average is shown (2 would reveal each other's). */
export const MIN_RATERS_FOR_AVERAGE = 3

export interface NormalizedRating {
  stars: number
  comment: string | null
}

/** @throws {DomainError} `INVALID_RATING`, `LABOR_FIELD_TOO_LONG` */
export function validateRating(input: {
  stars: number
  comment?: string | null | undefined
}): NormalizedRating {
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) {
    throw new DomainError('A rating is 1 to 5 stars', 'INVALID_RATING')
  }
  const comment = optionalText(input.comment) ?? null
  if (comment !== null && comment.length > MAX_RATING_COMMENT_LENGTH) {
    throw new DomainError(
      `A comment must be at most ${MAX_RATING_COMMENT_LENGTH} characters`,
      'LABOR_FIELD_TOO_LONG',
    )
  }
  return { stars: input.stars, comment }
}

/**
 * The anonymous average across every driver's rating of a crew, rounded to one
 * decimal — or null below `minCount` raters.
 */
export function aggregateRating(
  stars: readonly number[],
  minCount: number = MIN_RATERS_FOR_AVERAGE,
): { average: number; count: number } | null {
  if (stars.length < minCount || stars.length === 0) return null
  const sum = stars.reduce((a, b) => a + b, 0)
  return { average: Math.round((sum / stars.length) * 10) / 10, count: stars.length }
}

// ---------------------------------------------------------------------------
// Regions + service areas
// ---------------------------------------------------------------------------

export type LaborCountry = 'US' | 'CA'

export const US_STATES: ReadonlySet<string> = new Set(
  (
    'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV ' +
    'NH NJ NM NY NC ND OH OK OR PA PR RI SC SD TN TX UT VT VA WA WV WI WY'
  ).split(' '),
)

export const CA_PROVINCES: ReadonlySet<string> = new Set(
  'AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' '),
)

/** The country a 2-letter region code belongs to, or undefined. */
export function countryOfRegion(region: string): LaborCountry | undefined {
  const r = region.toUpperCase()
  if (US_STATES.has(r)) return 'US'
  if (CA_PROVINCES.has(r)) return 'CA'
  return undefined
}

export interface ServiceAreaInput {
  city: string
  region: string
}

export interface NormalizedServiceArea {
  city: string
  region: string
  country: LaborCountry
  cityKey: string
}

export const MAX_SERVICE_AREAS = 50

/**
 * Validates a crew's service-area list: each a city in a US state or Canadian
 * province, de-duplicated on (region, city).
 *
 * @throws {DomainError} `LABOR_FIELD_REQUIRED`, `INVALID_REGION`, `TOO_MANY_SERVICE_AREAS`
 */
export function validateServiceAreas(inputs: readonly ServiceAreaInput[]): NormalizedServiceArea[] {
  if (inputs.length > MAX_SERVICE_AREAS) {
    throw new DomainError(
      `A crew can have at most ${MAX_SERVICE_AREAS} service areas`,
      'TOO_MANY_SERVICE_AREAS',
    )
  }
  const seen = new Set<string>()
  const out: NormalizedServiceArea[] = []
  for (const input of inputs) {
    const city = requiredText(input.city, 'City', 100)
    const region = input.region.trim().toUpperCase()
    const country = countryOfRegion(region)
    if (!country) {
      throw new DomainError(
        `Not a US state or Canadian province: ${input.region}`,
        'INVALID_REGION',
      )
    }
    const cityKey = foldKey(city)
    const dedupe = `${country}|${region}|${cityKey}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    out.push({ city, region, country, cityKey })
  }
  return out
}

// ---------------------------------------------------------------------------
// Activity labor — the crews (and which of their packers) that worked one
// activity on an order
// ---------------------------------------------------------------------------

export const MAX_ACTIVITY_CREWS = 10

export interface ActivityLaborCrewInput {
  phone: string
  packerIds: readonly string[]
}

export interface NormalizedActivityLaborCrew {
  phone: string
  packerIds: string[]
}

/**
 * Validates the full set of crews assigned to an activity: phones normalised
 * to E.164, each crew at most once, each packer at most once across the set.
 * Whether a packer belongs to its crew is a stored fact, checked by the API.
 *
 * @throws {DomainError} `INVALID_PHONE_NUMBER`, `TOO_MANY_ACTIVITY_CREWS`,
 *   `DUPLICATE_ACTIVITY_CREW`, `DUPLICATE_ACTIVITY_PACKER`
 */
export function validateActivityLabor(
  crews: readonly ActivityLaborCrewInput[],
): NormalizedActivityLaborCrew[] {
  if (crews.length > MAX_ACTIVITY_CREWS) {
    throw new DomainError(
      `An activity can have at most ${MAX_ACTIVITY_CREWS} crews`,
      'TOO_MANY_ACTIVITY_CREWS',
    )
  }
  const phones = new Set<string>()
  const packers = new Set<string>()
  return crews.map((crew) => {
    const phone = normalizePhoneNumber(crew.phone)
    if (phones.has(phone)) {
      throw new DomainError(`Crew ${phone} is listed twice`, 'DUPLICATE_ACTIVITY_CREW')
    }
    phones.add(phone)
    const packerIds = [...new Set(crew.packerIds)]
    for (const id of packerIds) {
      if (packers.has(id)) {
        throw new DomainError(`Packer ${id} is on two crews`, 'DUPLICATE_ACTIVITY_PACKER')
      }
      packers.add(id)
    }
    return { phone, packerIds }
  })
}

// ---------------------------------------------------------------------------
// Location search
// ---------------------------------------------------------------------------

export type LocationQuery =
  | { kind: 'none' }
  | { kind: 'postal'; country: LaborCountry; code: string }
  | { kind: 'city'; cityKey: string; region: string | undefined }
  | { kind: 'region'; country: LaborCountry; region: string }
  | { kind: 'text'; text: string }

/**
 * Reads a search box. A US ZIP (or ZIP+4), a Canadian postal code or its first
 * three characters (the FSA), `City, ST`, or a bare state/province code are
 * locations; anything else is free text. A bare word that might be a city is
 * returned as `text` — the caller tries it as a city name too.
 */
export function parseLocationQuery(raw: string): LocationQuery {
  const q = raw.trim()
  if (!q) return { kind: 'none' }

  const zip = /^(\d{5})(?:-\d{4})?$/.exec(q)
  if (zip) return { kind: 'postal', country: 'US', code: zip[1]! }

  const ca = /^([A-Za-z]\d[A-Za-z])(?:\s*\d[A-Za-z]\d)?$/.exec(q)
  if (ca) return { kind: 'postal', country: 'CA', code: ca[1]!.toUpperCase() }

  if (/^[A-Za-z]{2}$/.test(q)) {
    const country = countryOfRegion(q)
    if (country) return { kind: 'region', country, region: q.toUpperCase() }
  }

  const cityRegion = /^(.+?),\s*([A-Za-z]{2})$/.exec(q)
  if (cityRegion && countryOfRegion(cityRegion[2]!)) {
    return {
      kind: 'city',
      cityKey: foldKey(cityRegion[1]!),
      region: cityRegion[2]!.toUpperCase(),
    }
  }

  return { kind: 'text', text: q }
}

export interface GeoPoint {
  lat: number
  lon: number
}

export interface RankableCrew {
  name: string
  serviceAreas: ReadonlyArray<{ lat: number | null; lon: number | null }>
}

/**
 * Sorts crews nearest first. A crew's distance is the shortest great-circle
 * distance from `origin` to any of its geocoded service areas; crews with none
 * sort last. Ties (and the ungeocoded tail) are broken by name.
 */
export function rankCrewsByDistance<T extends RankableCrew>(
  crews: readonly T[],
  origin: GeoPoint,
): Array<T & { distanceMiles: number | null }> {
  return crews
    .map((crew) => {
      let best: number | null = null
      for (const area of crew.serviceAreas) {
        if (area.lat === null || area.lon === null) continue
        const d = haversineMiles(origin.lat, origin.lon, area.lat, area.lon)
        if (best === null || d < best) best = d
      }
      return { ...crew, distanceMiles: best === null ? null : Math.round(best * 10) / 10 }
    })
    .sort((a, b) => {
      if (a.distanceMiles !== b.distanceMiles) {
        if (a.distanceMiles === null) return 1
        if (b.distanceMiles === null) return -1
        return a.distanceMiles - b.distanceMiles
      }
      return a.name.localeCompare(b.name)
    })
}

// ---------------------------------------------------------------------------
// Export — vCard (what phones import) and Google Contacts CSV
// ---------------------------------------------------------------------------

export interface ExportPacker {
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  cidNumber: string | null
  cidIssuedOn: string | null
}

export interface ExportCrew {
  phone: string
  name: string
  nickname: string | null
  email: string | null
  serviceAreas: ReadonlyArray<{ city: string; region: string }>
  myStars: number | null
  myComment: string | null
  packers: readonly ExportPacker[]
}

function crewDisplayName(crew: ExportCrew): string {
  return crew.nickname ?? crew.name
}

function crewNote(crew: ExportCrew): string {
  const lines: string[] = []
  if (crew.nickname && crew.nickname !== crew.name) lines.push(`Crew: ${crew.name}`)
  if (crew.serviceAreas.length) {
    lines.push(
      `Service areas: ${crew.serviceAreas.map((a) => `${a.city}, ${a.region}`).join('; ')}`,
    )
  }
  if (crew.myStars !== null) lines.push(`My rating: ${crew.myStars}/5`)
  if (crew.myComment) lines.push(`My comment: ${crew.myComment}`)
  if (crew.packers.length) {
    lines.push(`Packers: ${crew.packers.map((p) => `${p.firstName} ${p.lastName}`).join(', ')}`)
  }
  return lines.join('\n')
}

function packerNote(crew: ExportCrew, p: ExportPacker): string {
  const lines = [`Packer with ${crewDisplayName(crew)} (${formatPhoneNumber(crew.phone)})`]
  if (p.cidNumber) lines.push(`CID: ${p.cidNumber} (issued ${p.cidIssuedOn ?? 'unknown'})`)
  return lines.join('\n')
}

/** RFC 6350 §3.4 text escaping. */
function vcardEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

/** UTF-8 byte length of one code point (the domain has no TextEncoder). */
function utf8Bytes(ch: string): number {
  const cp = ch.codePointAt(0) as number
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
}

/** RFC 6350 §3.2 line folding: at most 75 octets per line, continuation with a space. */
function foldLine(line: string): string {
  let total = 0
  for (const ch of line) total += utf8Bytes(ch)
  if (total <= 75) return line
  const parts: string[] = []
  let current = ''
  let currentBytes = 0
  for (const ch of line) {
    const bytes = utf8Bytes(ch)
    const limit = parts.length === 0 ? 75 : 74 // continuation lines start with a space
    if (currentBytes + bytes > limit) {
      parts.push(current)
      current = ''
      currentBytes = 0
    }
    current += ch
    currentBytes += bytes
  }
  parts.push(current)
  return parts.join('\r\n ')
}

function vcard(fields: {
  given: string
  family: string
  formatted: string
  phone: string
  email: string | null
  org: string
  note: string
}): string {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${vcardEscape(fields.family)};${vcardEscape(fields.given)};;;`,
    `FN:${vcardEscape(fields.formatted)}`,
    `ORG:${vcardEscape(fields.org)}`,
  ]
  lines.push(`TEL;TYPE=CELL:${fields.phone}`)
  if (fields.email) lines.push(`EMAIL;TYPE=INTERNET:${fields.email}`)
  if (fields.note) lines.push(`NOTE:${vcardEscape(fields.note)}`)
  lines.push('END:VCARD')
  return lines.map(foldLine).join('\r\n')
}

/**
 * A `.vcf` file of the driver's crews — one contact per crew, plus one per
 * packer who has a phone number — that iOS and Android Contacts import as is.
 */
export function crewsToVCard(crews: readonly ExportCrew[]): string {
  const cards: string[] = []
  for (const crew of crews) {
    const display = crewDisplayName(crew)
    cards.push(
      vcard({
        given: display,
        family: '',
        formatted: display,
        phone: crew.phone,
        email: crew.email,
        org: 'Labor crew',
        note: crewNote(crew),
      }),
    )
    for (const p of crew.packers) {
      if (!p.phone) continue
      cards.push(
        vcard({
          given: p.firstName,
          family: p.lastName,
          formatted: `${p.firstName} ${p.lastName}`,
          phone: p.phone,
          email: p.email,
          org: crew.name,
          note: packerNote(crew, p),
        }),
      )
    }
  }
  return cards.length ? `${cards.join('\r\n')}\r\n` : ''
}

/** Column order of a Google Contacts CSV import (contacts.google.com → Import). */
export const GOOGLE_CONTACTS_CSV_HEADERS = [
  'First Name',
  'Last Name',
  'Organization Name',
  'Phone 1 - Label',
  'Phone 1 - Value',
  'E-mail 1 - Label',
  'E-mail 1 - Value',
  'Notes',
  'Labels',
] as const

/**
 * One CSV cell. Text that a spreadsheet would read as a formula (a leading
 * `=`, `+`, `-`, `@`, tab or CR) gets a leading `'` — the names, emails and
 * cities here are shared, editable by any linked driver, so an export must not
 * become a way to run `=HYPERLINK(...)` in someone else's Excel. A phone
 * number in E.164 (`+14045551212`) is the one `+` value left alone: it's ours,
 * normalised, and a quote would end up in the imported contact.
 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) && !/^\+\d{8,15}$/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** The same contacts as `crewsToVCard`, as a Google Contacts CSV. */
export function crewsToGoogleContactsCsv(crews: readonly ExportCrew[]): string {
  const rows: string[][] = [[...GOOGLE_CONTACTS_CSV_HEADERS]]
  for (const crew of crews) {
    rows.push([
      crewDisplayName(crew),
      '',
      'Labor crew',
      'Mobile',
      crew.phone,
      crew.email ? 'Work' : '',
      crew.email ?? '',
      crewNote(crew),
      'Labor crews',
    ])
    for (const p of crew.packers) {
      if (!p.phone) continue
      rows.push([
        p.firstName,
        p.lastName,
        crew.name,
        'Mobile',
        p.phone,
        p.email ? 'Work' : '',
        p.email ?? '',
        packerNote(crew, p),
        'Labor crews',
      ])
    }
  }
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`
}
