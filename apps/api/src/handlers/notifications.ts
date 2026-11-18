// ---------------------------------------------------------------------------
// /api/v1/notifications — staff-initiated push to drivers/crew (POST /send)
// and Workflow posts to Activity (POST /notify, below).
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
import { notify } from '../lib/notify'
import { kickPushForwarder } from '../lib/push-forward-invoke'
import { ROLE_OPTIONS } from '../authz/role-options'

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
// Response: { data: { id, notificationId, pushId } } (202 Accepted — queued,
//           not yet delivered; `id` = the push row, else the feed row)
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
      // TenantUser is not auto-scoped (TENANT_SCOPED_MODELS), so bind the tenant here.
      const user = await db.tenantUser.findFirst({
        where: { id: userId, tenantId },
        select: { id: true },
      })
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

    // Through notify() (type `staff.message`): an Activity row for the
    // recipient, plus the push unless they turned that type down to feed/off.
    const { notificationId, pushId } = await db.$transaction((tx) =>
      notify(tx, tenantId, {
        type: 'staff.message',
        recipient: userId != null ? { userId } : { crewMemberId: crewMemberId as string },
        title,
        body,
        ...(data ? { data } : {}),
        actorUserId: c.get('userId') ?? null,
        ...(dedupeKey != null ? { dedupeKey } : {}),
      }),
    )

    // `id` stays the push outbox row when there is one (the original contract).
    return c.json({ data: { id: pushId ?? notificationId, notificationId, pushId } }, 202)
  },
)

// ---------------------------------------------------------------------------
// POST /notify — a Workflow posts to its tenant's users' Activity (SDK
// `notify`). Gated by Actions.NotifyUsers (workflow_runtime; tenant_admin via
// the blanket admin policy). One fixed type, `workflow.message`: the type
// registry is the platform's, not the author's, and the server builds `data`.
// Each recipient's own channel decides feed / push / off (default: feed only).
//
// Recipients are named the way an author can know them — login email or role
// name — and resolved to the tenant's active, human users. An unknown email or
// role is a loud 400 (never a silent partial send); so is more than
// NOTIFY_MAX_RECIPIENTS. Internal-only, so not metered.
//
// `dedupKey` makes a retry a no-op, per recipient. It is namespaced
// (`workflow:<key>:<userId>`) so a Workflow can never claim a system event's key.
// ---------------------------------------------------------------------------

export const NOTIFY_MAX_RECIPIENTS = 100
const NOTIFY_ROLES = ROLE_OPTIONS.map((r) => r.name)

const NotifyBody = z
  .object({
    toEmails: z
      .array(z.string().trim().toLowerCase().email())
      .max(NOTIFY_MAX_RECIPIENTS)
      .optional(),
    toRoles: z.array(z.string().trim()).max(NOTIFY_ROLES.length).optional(),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(500),
    /** The order it is about — groups it under that order and links to its chat. */
    orderNum: z
      .union([z.number().int().positive(), z.string().regex(/^\d{1,12}$/)])
      .transform(String)
      .optional(),
    dedupKey: z
      .string()
      .regex(/^[A-Za-z0-9._:-]{1,200}$/, 'expected [A-Za-z0-9._:-]{1,200}')
      .optional(),
  })
  .refine((b) => (b.toEmails?.length ?? 0) + (b.toRoles?.length ?? 0) > 0, {
    message: 'name at least one recipient in toEmails or toRoles',
  })

notificationsHandler.post('/notify', requirePermission(Actions.NotifyUsers), async (c) => {
  const correlationId = c.get('correlationId')
  const parsed = NotifyBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json(
      {
        error: parsed.error.issues
          .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
          .join('; '),
        code: 'VALIDATION_ERROR',
        correlationId,
      },
      400,
    )
  }
  const { toEmails = [], toRoles = [], title, body, orderNum, dedupKey } = parsed.data

  const unknownRoles = toRoles.filter((r) => !NOTIFY_ROLES.includes(r))
  if (unknownRoles.length > 0) {
    return c.json(
      {
        error: `Unknown role(s): ${unknownRoles.join(', ')}. Valid roles: ${NOTIFY_ROLES.join(', ')}`,
        code: 'UNKNOWN_ROLE',
        correlationId,
      },
      400,
    )
  }

  const tenantId = c.get('tenantId')
  const db = c.get('db')
  // TenantUser is not auto-scoped (TENANT_SCOPED_MODELS), so bind the tenant here.
  const users = await db.tenantUser.findMany({
    where: {
      tenantId,
      status: { not: 'DEACTIVATED' },
      isServiceAccount: false,
      OR: [
        ...(toEmails.length > 0 ? [{ email: { in: toEmails, mode: 'insensitive' as const } }] : []),
        ...(toRoles.length > 0 ? [{ roleNames: { hasSome: toRoles } }] : []),
      ],
    },
    select: { id: true, email: true },
  })

  const found = new Set(users.map((u) => u.email.toLowerCase()))
  const unknownEmails = toEmails.filter((e) => !found.has(e))
  if (unknownEmails.length > 0) {
    return c.json(
      {
        error: `No active user in this tenant with email: ${unknownEmails.join(', ')}`,
        code: 'UNKNOWN_RECIPIENT',
        correlationId,
      },
      400,
    )
  }
  if (users.length > NOTIFY_MAX_RECIPIENTS) {
    return c.json(
      {
        error: `That names ${users.length} people; the limit is ${NOTIFY_MAX_RECIPIENTS}. Narrow the roles.`,
        code: 'TOO_MANY_RECIPIENTS',
        correlationId,
      },
      400,
    )
  }

  const results = await db.$transaction(async (tx) => {
    const out: Array<{ notificationId: string | null; pushId: string | null }> = []
    for (const u of users) {
      out.push(
        await notify(tx, tenantId, {
          type: 'workflow.message',
          recipient: { userId: u.id },
          title,
          body,
          data: { type: 'workflow.message', ...(orderNum ? { orderNum } : {}) },
          actorUserId: c.get('userId') ?? null,
          ...(orderNum
            ? { entityType: 'order', entityId: orderNum, groupKey: `order:${orderNum}` }
            : {}),
          ...(dedupKey ? { dedupeKey: `workflow:${dedupKey}:${u.id}` } : {}),
        }),
      )
    }
    return out
  })
  const pushed = results.filter((r) => r.pushId).length
  if (pushed > 0) await kickPushForwarder()

  return c.json({
    data: {
      recipients: users.length,
      /** Recipients who got an Activity row (the rest turned this type off). */
      notified: results.filter((r) => r.notificationId).length,
      /** Recipients whose phones were also pushed (they chose Push). */
      pushed,
    },
  })
})
