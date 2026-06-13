// ---------------------------------------------------------------------------
// Device-token repository — push registration persistence.
//
// One row per (tenantId, expoPushToken). The mobile app registers/refreshes a
// token after the driver grants notification permission; the push forwarder
// resolves a target user/crew member into the active tokens here and deactivates
// any Expo reports as dead.
//
// Functions take a PrismaClient (tenant-scoped via createTenantDb for the API
// handlers; base client for the cross-tenant forwarder) plus an explicit
// tenantId on writes, matching the repo convention (cf. messaging.repository).
// ---------------------------------------------------------------------------

import type { PrismaClient, DevicePlatform } from '@prisma/client'

export type RegisterDeviceTokenInput = {
  /** The TenantUser this device belongs to (the logged-in driver). */
  userId: string
  platform: DevicePlatform
  expoPushToken: string
}

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
    },
    update: {
      userId: input.userId,
      platform: input.platform,
      isActive: true,
      lastSeenAt: now,
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

/** Lists a user's active Expo push tokens within a tenant. */
export async function listActiveTokensForUser(
  db: PrismaClient,
  tenantId: string,
  userId: string,
): Promise<string[]> {
  const rows = await db.deviceToken.findMany({
    where: { tenantId, userId, isActive: true },
    select: { expoPushToken: true },
  })
  return rows.map((r) => r.expoPushToken)
}

/** Lists the current user's registered devices for the settings screen (no token values). */
export async function listDevicesForUser(db: PrismaClient, tenantId: string, userId: string) {
  return db.deviceToken.findMany({
    where: { tenantId, userId },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, platform: true, isActive: true, lastSeenAt: true, createdAt: true },
  })
}
