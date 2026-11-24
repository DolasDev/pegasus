// ---------------------------------------------------------------------------
// Device-token repository — push registration persistence.
//
// One row per (tenantId, expoPushToken). The mobile app registers/refreshes its
// token on every login / foreground resume — WHETHER OR NOT notifications are
// allowed — and reports the OS permission with it (`pushPermission`), so
// dispatch can see a driver who has them off. The push forwarder resolves a
// target user/crew member into the deliverable tokens here (never one whose
// permission is ASKABLE/BLOCKED) and deactivates any Expo reports as dead.
//
// Functions take a PrismaClient (tenant-scoped via createTenantDb for the API
// handlers; base client for the cross-tenant forwarder) plus an explicit
// tenantId on writes, matching the repo convention (cf. messaging.repository).
// ---------------------------------------------------------------------------

import type { PrismaClient, DevicePlatform, PushPermission } from '@prisma/client'

export type RegisterDeviceTokenInput = {
  /** The TenantUser this device belongs to (the logged-in driver). */
  userId: string
  platform: DevicePlatform
  expoPushToken: string
  /**
   * The OS notification permission the app reports. Omitted by app versions
   * that predate reporting it — the stored value is then left untouched.
   */
  pushPermission?: PushPermission
}

/**
 * Permissions a push can actually be shown under. Null is an app version that
 * predates reporting — those only ever registered once permission was granted.
 * CHANNEL_OFF still delivers (the app may post to another channel); it is a
 * nudge on the phone, not a reason to stop sending.
 */
export const DELIVERABLE_PERMISSIONS: PushPermission[] = ['GRANTED', 'LIMITED', 'CHANNEL_OFF']

/**
 * Registers or refreshes a device token. Idempotent on (tenantId,
 * expoPushToken): a re-register (login / foreground resume, or the token moving
 * to a different user on the same device) reactivates the row, re-points it at
 * the current user, and stamps lastSeenAt. Returns the row id.
 */
export async function upsertDeviceToken(
  db: PrismaClient,
  tenantId: string,
  input: RegisterDeviceTokenInput,
): Promise<string> {
  const now = new Date()
  const row = await db.deviceToken.upsert({
    where: { tenantId_expoPushToken: { tenantId, expoPushToken: input.expoPushToken } },
    create: {
      tenantId,
      userId: input.userId,
      platform: input.platform,
      expoPushToken: input.expoPushToken,
      isActive: true,
      lastSeenAt: now,
      pushPermission: input.pushPermission ?? null,
    },
    update: {
      userId: input.userId,
      platform: input.platform,
      isActive: true,
      lastSeenAt: now,
      ...(input.pushPermission ? { pushPermission: input.pushPermission } : {}),
    },
    select: { id: true },
  })
  return row.id
}

/**
 * Deactivates a single token for a tenant (logout). Uses updateMany so a missing
 * or foreign token is a no-op (count 0) rather than a throw. Returns rows changed.
 */
export async function deactivateDeviceToken(
  db: PrismaClient,
  tenantId: string,
  expoPushToken: string,
): Promise<number> {
  const { count } = await db.deviceToken.updateMany({
    where: { tenantId, expoPushToken, isActive: true },
    data: { isActive: false },
  })
  return count
}

/**
 * Deactivates tokens by value across all tenants. Called by the forwarder when
 * Expo reports DeviceNotRegistered — the token is globally dead, so it is
 * retired regardless of tenant. Base client (cross-tenant cron context).
 */
export async function deactivateTokensByValue(
  db: PrismaClient,
  expoPushTokens: string[],
): Promise<number> {
  if (expoPushTokens.length === 0) return 0
  const { count } = await db.deviceToken.updateMany({
    where: { expoPushToken: { in: expoPushTokens }, isActive: true },
    data: { isActive: false },
  })
  return count
}

/**
 * Lists a user's DELIVERABLE Expo push tokens within a tenant: active, and not
 * reported as ASKABLE/BLOCKED (a push there would be dropped by the OS and
 * still count as sent). Before permission reporting those devices had no row
 * at all, so this keeps delivery exactly as it was.
 */
export async function listActiveTokensForUser(
  db: PrismaClient,
  tenantId: string,
  userId: string,
): Promise<string[]> {
  const rows = await db.deviceToken.findMany({
    where: {
      tenantId,
      userId,
      isActive: true,
      OR: [{ pushPermission: null }, { pushPermission: { in: DELIVERABLE_PERMISSIONS } }],
    },
    select: { expoPushToken: true },
  })
  return rows.map((r) => r.expoPushToken)
}

/**
 * Active devices of a set of users, with their reported permission — the
 * dispatcher's "can this driver get notifications?" read (no token values).
 */
export async function listActiveDevicesForUsers(
  db: PrismaClient,
  tenantId: string,
  userIds: string[],
) {
  if (userIds.length === 0) return []
  return db.deviceToken.findMany({
    where: { tenantId, userId: { in: userIds }, isActive: true },
    orderBy: { lastSeenAt: 'desc' },
    select: { userId: true, platform: true, pushPermission: true, lastSeenAt: true },
  })
}

/** Lists the current user's registered devices for the settings screen (no token values). */
export async function listDevicesForUser(db: PrismaClient, tenantId: string, userId: string) {
  return db.deviceToken.findMany({
    where: { tenantId, userId },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, platform: true, isActive: true, lastSeenAt: true, createdAt: true },
  })
}
