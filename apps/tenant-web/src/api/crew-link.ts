import { getConfig } from '../config'

// ---------------------------------------------------------------------------
// Public crew-link API — the page a crew leader (no login) opens from a link a
// driver shared. See apps/api/src/handlers/crew-link-public.ts.
//
// Deliberately NOT apiFetch: that attaches the signed-in tenant user's bearer,
// and this page must never send one (a driver testing their own link would
// otherwise hand their Cognito token to a public endpoint). The only credential
// is the session from verifying the texted code, sent as X-Crew-Session and
// kept in sessionStorage — never a cookie.
// ---------------------------------------------------------------------------

export class CrewLinkError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    /** Wrong-code attempts left before the link stops working. */
    readonly attemptsLeft: number | null = null,
  ) {
    super(message)
    this.name = 'CrewLinkError'
  }
}

async function call<T>(
  token: string,
  path: string,
  init: RequestInit & { session?: string | null } = {},
): Promise<T> {
  const { session, ...rest } = init
  const headers = new Headers(rest.headers)
  headers.set('Content-Type', 'application/json')
  if (session) headers.set('X-Crew-Session', session)
  const res = await globalThis.fetch(
    `${getConfig().apiUrl}/api/public/v1/crew-link/${encodeURIComponent(token)}${path}`,
    { ...rest, headers, credentials: 'omit', referrerPolicy: 'no-referrer' },
  )
  if (res.status === 204) return null as T
  const json = (await res.json().catch(() => ({}))) as {
    data?: T
    error?: string
    code?: string
    attemptsLeft?: number
  }
  if (!res.ok || json.error) {
    throw new CrewLinkError(
      json.error ?? 'Something went wrong. Try again.',
      json.code ?? 'UNKNOWN',
      res.status,
      json.attemptsLeft ?? null,
    )
  }
  return json.data as T
}

// ── Session storage (per link token) ─────────────────────────────────────────

const sessionKey = (token: string) => `crew-link-session:${token}`

export function loadSession(token: string): string | null {
  try {
    return globalThis.sessionStorage.getItem(sessionKey(token))
  } catch {
    return null
  }
}

export function saveSession(token: string, session: string | null): void {
  try {
    if (session) globalThis.sessionStorage.setItem(sessionKey(token), session)
    else globalThis.sessionStorage.removeItem(sessionKey(token))
  } catch {
    // Private mode / blocked storage: the session simply lasts this page view.
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface CrewJobAddress {
  street: string | null
  unit: string | null
  city: string | null
  state: string | null
  zip: string | null
}

export interface CrewJobActivity {
  id: number
  typeCode: string | null
  typeName: string
  plannedStart: string | null
  estimatedDate: string | null
  actualDate: string | null
  arrivalWindow: { start: string; end: string } | null
  address: CrewJobAddress | null
  packerIds: string[]
}

export interface CrewPacker {
  id: string
  firstName: string
  lastName: string
  email: string | null
  cidNumber: string | null
  cidIssuedOn: string | null
  phone: string | null
  phoneDisplay: string | null
  updatedAt: string
}

export interface CrewJob {
  orderNum: number
  crew: { name: string; phoneDisplay: string }
  weight: { estimated: number | null; actual: number | null }
  activities: CrewJobActivity[]
  packers: CrewPacker[]
  linkExpiresAt: string
}

export interface PackerInput {
  firstName: string
  lastName: string
  email?: string | null
  cidNumber?: string | null
  cidIssuedOn?: string | null
  phone?: string | null
}

// ── Calls ────────────────────────────────────────────────────────────────────

export function requestCode(token: string) {
  return call<{ sent: true; phoneHint: string; expiresAt: string }>(token, '/otp', {
    method: 'POST',
  })
}

export function verifyCode(token: string, code: string) {
  return call<{ session: string; expiresAt: string }>(token, '/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export function getCrewJob(token: string, session: string) {
  return call<CrewJob>(token, '/job', { session })
}

export function setActivityPackers(
  token: string,
  session: string,
  activityId: number,
  packerIds: string[],
) {
  return call<{ activityId: number; packerIds: string[] }>(
    token,
    `/activities/${activityId}/packers`,
    { method: 'PUT', session, body: JSON.stringify({ packerIds }) },
  )
}

export function addPacker(token: string, session: string, input: PackerInput) {
  return call<CrewPacker>(token, '/packers', {
    method: 'POST',
    session,
    body: JSON.stringify(input),
  })
}

export function updatePacker(token: string, session: string, id: string, input: PackerInput) {
  return call<CrewPacker>(token, `/packers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    session,
    body: JSON.stringify(input),
  })
}

export function removePacker(token: string, session: string, id: string) {
  return call<null>(token, `/packers/${encodeURIComponent(id)}`, { method: 'DELETE', session })
}
