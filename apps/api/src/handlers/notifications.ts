// ---------------------------------------------------------------------------
// /api/v1/notifications — staff-initiated push to drivers/crew.
//
// POST /send lets a dispatcher/admin enqueue an ad-hoc notification to a single
// driver. Gated by Cedar Actions.SendNotification (tenant_admin holds it via the
// blanket admin policy; dispatch personas can be granted it later). The handler
// only ENQUEUES into the PushNotificationOutbox — the scheduled push-forward
// Lambda performs the actual Expo delivery, so a provider hiccup never fails the
// request and every send is durable + retried.
//
// Targeting: exactly one of { userId, crewMemberId }. The target is verified to
// belong to the caller's tenant (the scoped client makes cross-tenant lookups
// return nothing) before the row is enqueued, so a 404 is returned for an
// unknown/foreign id rather than silently queuing an undeliverable row.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { requirePermission } from '../middleware/rbac'
import { Actions } from '../authz/actions'
import type { AppEnv } from '../types'
import { enqueuePush } from '../repositories/push-outbox.repository'

const SendBody = z
  .object({
    /** Target a tenant login directly... */
    userId: z.string().min(1).optional(),
    /** ...or a crew member (resolved to its linked login at delivery time). */
    crewMemberId: z.string().min(1).optional(),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(500),
    /** Optional structured payload carried to the device (e.g. a deep link). */
    data: z.record(z.string(), z.unknown()).optional(),
    /** Optional idempotency key (unique per tenant) to collapse duplicate sends. */
    dedupeKey: z.string().min(1).max(255).optional(),
  })
  .refine((d) => (d.userId == null) !== (d.crewMemberId == null), {
    message: 'Provide exactly one of userId or crewMemberId',
  })

export const notificationsHandler = new Hono<AppEnv>()

// ---------------------------------------------------------------------------
// POST /send — enqueue a notification to one driver/crew member.
//
// Response: { data: { id } } (202 Accepted — queued, not yet delivered)
//           { error, code: NOT_FOUND }        (404) — target not in this tenant
//           { error, code: VALIDATION_ERROR } (400)
// ---------------------------------------------------------------------------
notificationsHandler.post(
  '/send',
  requirePermission(Actions.SendNotification),
  validator('json', (value, c) => {
    const r = SendBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const tenantId = c.get('tenantId')
    const { userId, crewMemberId, title, body, data, dedupeKey } = c.req.valid('json')

    // Verify the target exists within this tenant (scoped client → tenant-safe).
    if (userId != null) {
      const user = await db.tenantUser.findFirst({ where: { id: userId }, select: { id: true } })
      if (!user) {
        return c.json({ error: 'Target user not found in this tenant', code: 'NOT_FOUND' }, 404)
      }
    } else if (crewMemberId != null) {
      const crew = await db.crewMember.findFirst({
        where: { id: crewMemberId },
        select: { id: true },
      })
      if (!crew) {
        return c.json(
          { error: 'Target crew member not found in this tenant', code: 'NOT_FOUND' },
          404,
        )
      }
    }

    const id = await db.$transaction((tx) =>
      enqueuePush(tx, tenantId, {
        ...(userId != null ? { userId } : {}),
        ...(crewMemberId != null ? { crewMemberId } : {}),
        payload: { title, body, ...(data ? { data } : {}) },
        ...(dedupeKey != null ? { dedupeKey } : {}),
      }),
    )

    return c.json({ data: { id } }, 202)
  },
)
