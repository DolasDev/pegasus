// ---------------------------------------------------------------------------
// /api/v1/device-tokens — push-notification device registration.
//
// Self-service: the mobile app registers/refreshes the current user's Expo push
// token after the driver grants notification permission, and deactivates it on
// logout. Like /api/v1/me there is NO requirePermission gate — the principal
// only ever acts on their OWN devices: userId is taken from the validated JWT
// (c.get('userId')), never from the request body, so cross-user registration is
// structurally impossible.
//
// Endpoints:
//   GET    /   — list the current user's registered devices (no token values)
//   POST   /   — register or refresh a device token (idempotent)
//   DELETE /   — deactivate a device token (logout)
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { AppEnv } from '../types'
import {
  upsertDeviceToken,
  deactivateDeviceToken,
  listDevicesForUser,
} from '../repositories/device-tokens.repository'

// Expo push tokens look like `ExponentPushToken[xxxxxxxx]` (or `ExpoPushToken[...]`).
// The Expo server SDK does the authoritative check at send time; this is a cheap
// shape guard so obvious garbage is rejected at the edge.
const ExpoPushToken = z
  .string()
  .min(1)
  .max(255)
  .regex(/^Expo(nent)?PushToken\[.+\]$/, 'must be a valid Expo push token')

const RegisterBody = z.object({
  platform: z.enum(['IOS', 'ANDROID']),
  expoPushToken: ExpoPushToken,
})

const DeactivateBody = z.object({
  expoPushToken: ExpoPushToken,
})

export const deviceTokensHandler = new Hono<AppEnv>()

// ---------------------------------------------------------------------------
// GET / — the current user's devices (for a "manage devices" settings screen).
// ---------------------------------------------------------------------------
deviceTokensHandler.get('/', async (c) => {
  const userId = c.get('userId')
  if (!userId) {
    return c.json({ error: 'No tenant user resolved for this principal', code: 'NO_USER' }, 409)
  }
  const db = c.get('db')
  const devices = await listDevicesForUser(db, c.get('tenantId'), userId)
  return c.json({
    data: devices.map((d) => ({
      id: d.id,
      platform: d.platform,
      isActive: d.isActive,
      lastSeenAt: d.lastSeenAt.toISOString(),
      createdAt: d.createdAt.toISOString(),
    })),
    meta: { count: devices.length },
  })
})

// ---------------------------------------------------------------------------
// POST / — register or refresh the current user's device token.
//
// Idempotent on (tenant, token): re-registering on login / foreground resume
// reactivates the row and stamps lastSeenAt. Response: { data: { id } } (201).
// ---------------------------------------------------------------------------
deviceTokensHandler.post(
  '/',
  validator('json', (value, c) => {
    const r = RegisterBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json({ error: 'No tenant user resolved for this principal', code: 'NO_USER' }, 409)
    }
    const db = c.get('db')
    const { platform, expoPushToken } = c.req.valid('json')
    const id = await upsertDeviceToken(db, c.get('tenantId'), { userId, platform, expoPushToken })
    return c.json({ data: { id } }, 201)
  },
)

// ---------------------------------------------------------------------------
// DELETE / — deactivate a device token (logout). Idempotent: an unknown or
// already-inactive token returns 200 with deactivated:false.
// ---------------------------------------------------------------------------
deviceTokensHandler.delete(
  '/',
  validator('json', (value, c) => {
    const r = DeactivateBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const { expoPushToken } = c.req.valid('json')
    const count = await deactivateDeviceToken(db, c.get('tenantId'), expoPushToken)
    return c.json({ data: { deactivated: count > 0 } })
  },
)
