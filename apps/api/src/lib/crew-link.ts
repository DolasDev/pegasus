// ---------------------------------------------------------------------------
// Crew links — the login-free page a crew leader uses to staff their activities.
//
// A driver shares a link (a CrewAccessLink token) for one crew on one order. The
// token alone grants nothing: opening it asks for a one-time code, which the
// platform texts to the crew's phone ON FILE (`Crew.phone`) through the tenant's
// RingCentral connection. The page never takes a phone number, so a forwarded
// link is useless without the crew's phone. Verifying the code mints a short
// session bearer (X-Crew-Session header — never a cookie).
//
// A tenant with no working RingCentral connection cannot send the code, so the
// feature is simply unavailable there (Steve, 2026-10-28) — no link-only mode.
//
// Every limit is counted in Postgres: the API has no request throttling.
// Plan: plans/completed/*-crew-leader-link.md.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { readOAuthConfig } from '../services/ringcentral/oauth'
import { listConnectionsByTenant } from '../repositories/messaging.repository'
import { executeSql } from './mssql-executor-client'
import { STORAGE_CODES, day, text } from './itinerary/values'

/** A shared link stays usable this long; sharing again mints a fresh one. */
export const LINK_TTL_MS = 14 * 24 * 60 * 60_000
/** A texted code is accepted for this long. */
export const OTP_TTL_MS = 10 * 60_000
/** A verified session lasts this long (never past its link's expiry). */
export const SESSION_TTL_MS = 12 * 60 * 60_000
/** Wrong codes in a row that burn the link. */
export const MAX_FAILED_ATTEMPTS = 5
/** Codes one link may send per rolling hour. */
export const OTP_SENDS_PER_LINK_PER_HOUR = 3
/** Codes one crew phone may receive per rolling day, across every link. */
export const OTP_SENDS_PER_PHONE_PER_DAY = 10

/** Master switch — the public surface and the share action 404 / hide when off. */
export function isCrewLinkEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['CREW_LEADER_LINK_ENABLED'] === 'true'
}

/** The page a crew leader opens: `<tenant SPA origin>/c/<token>`. */
export function crewLinkUrl(token: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = (env['CREW_LEADER_LINK_PUBLIC_WEB_URL'] ?? '').replace(/\/+$/, '')
  return `${base}/c/${token}`
}

/**
 * Whether this tenant can use crew links: the feature is on and the tenant has
 * a working RingCentral connection to text the code from — the same connection
 * `sendTenantSms` would pick.
 */
export async function crewLinkAvailable(db: PrismaClient, tenantId: string): Promise<boolean> {
  if (!isCrewLinkEnabled() || !readOAuthConfig()) return false
  const connections = await listConnectionsByTenant(db, tenantId)
  return connections.some((conn) => conn.tokenStatus === 'ACTIVE' && conn.tokenSecretArn != null)
}

/** A uniformly random 6-digit code. */
export function generateOtpCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

/** The stored form of a code — bound to its link so a hash can't be replayed elsewhere. */
export function hashOtp(linkId: string, code: string): string {
  return crypto.createHash('sha256').update(`${linkId}:${code}`).digest('hex')
}

export function otpMatches(linkId: string, code: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashOtp(linkId, code))
  const expected = Buffer.from(expectedHash)
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

/** `•••• 1234` — enough for the leader to recognise their own number. */
export function phoneHint(e164: string): string {
  return `•••• ${e164.slice(-4)}`
}

// ---------------------------------------------------------------------------
// The job, as the crew leader sees it — read from the tenant's legacy database.
// Deliberately narrow: the activity's own address, its days and arrival window,
// and the order's weights. No customer name, phone or email is selected.
// ---------------------------------------------------------------------------

/** One activity row of the crew page's read. `a.*` because the arrival-window
 *  columns exist only on tenants that have set one (see itinerary/fetch.ts). */
export interface CrewJobActivityRow {
  id: number
  order_num: number
  ActivityType_code: unknown
  planned_start: unknown
  estimated_date: unknown
  actual_date: unknown
  street: unknown
  unit: unknown
  city: unknown
  state: unknown
  zip: unknown
  arrival_window_start?: unknown
  arrival_window_end?: unknown
  cl_type_name: unknown
  cl_type_abbreviation: unknown
  cl_est_wt: unknown
  cl_actual_wt: unknown
}

const CREW_JOB_SQL =
  'SELECT a.*,' +
  ' at.name AS cl_type_name, at.abbreviation AS cl_type_abbreviation,' +
  ' so.total_est_wt AS cl_est_wt, so.weight AS cl_actual_wt' +
  ' FROM LongDistanceDispatchActivity a' +
  ' LEFT JOIN Longhaul_ActivityType at ON a.ActivityType_code = at.code' +
  // `sales` is 1:1 with an order by convention only — TOP 1 so a stray
  // duplicate can't duplicate the activity.
  ' OUTER APPLY (SELECT TOP 1 s.total_est_wt, s.weight FROM sales s WHERE s.order_num = a.order_num) so' +
  ' WHERE a.order_num = @orderNum' +
  ' ORDER BY COALESCE(a.actual_date, a.estimated_date, a.planned_start), a.id'

/** Every activity on the order with the crew page's columns. Throws on a legacy error. */
export async function crewJobActivities(
  connectionString: string,
  orderNum: number,
): Promise<CrewJobActivityRow[]> {
  const { recordset } = await executeSql(connectionString, CREW_JOB_SQL, {
    params: [{ name: 'orderNum', value: orderNum }],
  })
  return recordset as CrewJobActivityRow[]
}

function weight(v: unknown): number | null {
  const n = Number(v)
  return v != null && v !== '' && Number.isFinite(n) && n > 0 ? n : null
}

export function crewJobActivityDto(row: CrewJobActivityRow) {
  const code = text(row.ActivityType_code)?.toUpperCase() ?? null
  // The window columns hold wall-clock `HH:mm` text, as the itinerary reads them.
  const start = text(row.arrival_window_start)
  const end = text(row.arrival_window_end)
  return {
    id: row.id,
    typeCode: code,
    typeName: text(row.cl_type_name) ?? text(row.cl_type_abbreviation) ?? code ?? 'Activity',
    plannedStart: day(row.planned_start),
    estimatedDate: day(row.estimated_date),
    actualDate: day(row.actual_date),
    arrivalWindow: start && end ? { start, end } : null,
    // Storage work happens at a warehouse — no customer address, like the itinerary.
    address:
      code !== null && STORAGE_CODES.has(code)
        ? null
        : {
            street: text(row.street),
            unit: text(row.unit),
            city: text(row.city),
            state: text(row.state),
            zip: text(row.zip),
          },
  }
}

/** The order's weights, from the first row (they come from `sales`, one per order). */
export function crewJobWeights(rows: readonly CrewJobActivityRow[]) {
  const first = rows[0]
  return {
    estimated: first ? weight(first.cl_est_wt) : null,
    actual: first ? weight(first.cl_actual_wt) : null,
  }
}
