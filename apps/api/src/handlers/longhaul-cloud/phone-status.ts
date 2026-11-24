// ---------------------------------------------------------------------------
// GET /onprem/longhaul/drivers/phone-status — can this driver get push
// notifications right now?
//
// Shown to dispatchers in Operations → Itinerary next to the driver pickers.
// Gated by an Operations role, exactly like `/drivers/itinerary` beside it (a
// role-name gate, not Cedar — see lib/longhaul-read-scope.ts).
//
// Postgres only. The two driver ids are separate numbering spaces (longhaul
// `v_longhaul_drivers` vs local `crews`, mapped on TenantUser) and sometimes
// different people, so each id resolves to the logins mapped to it and gets
// its OWN answer — never one merged verdict. Those logins' ACTIVE devices carry the
// OS notification permission the mobile app reports on every login / resume
// (DeviceToken.pushPermission). No token values leave the API.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { PrismaClient, PushPermission, DevicePlatform } from '@prisma/client'
import { z } from 'zod'
import type { AppEnv } from '../../types'
import { hasOperationsRole } from '../../lib/longhaul-read-scope'
import { listActiveDevicesForUsers } from '../../repositories/device-tokens.repository'

const driverId = z.coerce.number().int().positive()

const Query = z
  .object({
    longhaulDriverId: driverId.optional(),
    localDriverEmployeeId: driverId.optional(),
  })
  .refine((q) => q.longhaulDriverId !== undefined || q.localDriverEmployeeId !== undefined, {
    message: 'name the driver by longhaulDriverId, localDriverEmployeeId, or both',
    path: ['longhaulDriverId'],
  })

/** The mobile app's own words for the permission (apps/mobile PermissionState). */
const PERMISSION_FROM_DB: Record<PushPermission, DevicePermission> = {
  GRANTED: 'granted',
  LIMITED: 'limited',
  ASKABLE: 'askable',
  BLOCKED: 'blocked',
  CHANNEL_OFF: 'channelOff',
}

export type DevicePermission = 'granted' | 'limited' | 'askable' | 'blocked' | 'channelOff'

/**
 * - `on`        the phone the driver opened most recently can show notifications
 * - `off`       that phone has notifications off (incl. a switched-off channel)
 * - `unknown`   that phone runs an app version too old to report it
 * - `noApp`     a login is mapped to this driver id, but no active phone
 * - `notLinked` no login is mapped to this driver id
 */
export type PhoneStatus = 'on' | 'off' | 'unknown' | 'noApp' | 'notLinked'

export interface PhoneStatusDevice {
  platform: DevicePlatform
  /** Null: an app version that predates permission reporting. */
  permission: DevicePermission | null
  lastSeenAt: string
}

/** One driver id's answer. No emails: Operations roles can't list users. */
export interface DriverPhoneStatus {
  status: PhoneStatus
  /** When the deciding phone last opened the app (null when there is none). */
  lastSeenAt: string | null
  /** Every active phone, newest first. */
  devices: PhoneStatusDevice[]
}

/**
 * Pure verdict for ONE driver id. Exported for tests.
 *
 * The phone the driver opened MOST RECENTLY decides — not "any phone": an old
 * handset that still has notifications on says nothing about the phone the
 * driver actually carries, and the verdict and its "as of" time must describe
 * the same device.
 */
export function summarizePhoneStatus(
  linked: boolean,
  devices: PhoneStatusDevice[],
): DriverPhoneStatus {
  if (!linked) return { status: 'notLinked', lastSeenAt: null, devices: [] }
  const sorted = [...devices].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
  const newest = sorted[0]
  if (!newest) return { status: 'noApp', lastSeenAt: null, devices: [] }
  const status: PhoneStatus =
    newest.permission === 'granted' || newest.permission === 'limited'
      ? 'on'
      : newest.permission === null
        ? 'unknown'
        : 'off'
  return { status, lastSeenAt: newest.lastSeenAt, devices: sorted }
}

/** The answer for one id space (logins mapped by `field` to `id`). */
async function statusFor(
  db: PrismaClient,
  tenantId: string,
  field: 'longhaulDriverId' | 'localDriverEmployeeId',
  id: number,
): Promise<DriverPhoneStatus> {
  const users = await db.tenantUser.findMany({
    where: { tenantId, status: { not: 'DEACTIVATED' }, [field]: id },
    select: { id: true },
  })
  const devices = await listActiveDevicesForUsers(
    db,
    tenantId,
    users.map((u) => u.id),
  )
  return summarizePhoneStatus(
    users.length > 0,
    devices.map((d) => ({
      platform: d.platform,
      permission: d.pushPermission ? PERMISSION_FROM_DB[d.pushPermission] : null,
      lastSeenAt: d.lastSeenAt.toISOString(),
    })),
  )
}

/**
 * One answer PER picked id. The longhaul and local ids are separate numbering
 * spaces and sometimes different people (ItineraryModule header), so they are
 * never merged into one verdict.
 */
export async function readPhoneStatus(
  db: PrismaClient,
  tenantId: string,
  ids: { longhaulDriverId?: number | undefined; localDriverEmployeeId?: number | undefined },
): Promise<{ longhaul: DriverPhoneStatus | null; local: DriverPhoneStatus | null }> {
  return {
    longhaul:
      ids.longhaulDriverId === undefined
        ? null
        : await statusFor(db, tenantId, 'longhaulDriverId', ids.longhaulDriverId),
    local:
      ids.localDriverEmployeeId === undefined
        ? null
        : await statusFor(db, tenantId, 'localDriverEmployeeId', ids.localDriverEmployeeId),
  }
}

export const driverPhoneStatusHandler: Handler<AppEnv> = async (c) => {
  const correlationId = c.get('correlationId')
  if (!hasOperationsRole(c.get('principal')?.roleNames ?? [])) {
    return c.json(
      {
        error: "Reading a driver's phone status needs an Operations role",
        code: 'FORBIDDEN',
        correlationId,
      },
      403,
    )
  }
  const parsed = Query.safeParse(c.req.query())
  if (!parsed.success) {
    return c.json(
      {
        error: parsed.error.issues
          .map((i) => `${i.path.join('.') || 'query'}: ${i.message}`)
          .join('; '),
        code: 'VALIDATION_ERROR',
        correlationId,
      },
      400,
    )
  }
  return c.json({ data: await readPhoneStatus(c.get('db'), c.get('tenantId'), parsed.data) })
}
