// ---------------------------------------------------------------------------
// notify() — the one way to tell a person something (task queue plan, TQ-D1).
//
// Writes the recipient's Activity feed row and, when their channel for the
// type is `push`, enqueues the push. Push is a channel of Activity; the outbox
// stays a delivery queue with no read state.
//
// Contract:
//   • Runs on the CALLER's client or transaction and never opens one, so the
//     feed row and the push commit with the state change that prompted them.
//   • Never kicks the push forwarder — a caller that needs speed (chat) kicks
//     after its own commit, using the returned pushId.
//   • `dedupeKey` makes it idempotent: the same logical event (a trip re-saved
//     twenty times) keeps one feed row and one push.
//   • A crew member with no login gets the push only (resolved to their device
//     at drain time, as before) — there is no user to own a feed row.
//   • The push payload is exactly `{ title, body, data? }`, the shape phones
//     already route on, so moving a sender onto notify() changes no handset.
// ---------------------------------------------------------------------------

import type { Prisma } from '@prisma/client'
import {
  channelWrites,
  effectiveChannel,
  isNotificationChannel,
  type NotificationType,
} from '@pegasus/domain'
import { enqueuePush } from '../repositories/push-outbox.repository'

export type NotifyRecipient = { userId: string } | { crewMemberId: string }

export interface NotifyInput {
  type: NotificationType
  recipient: NotifyRecipient
  title: string
  body: string
  /** The deep-link payload, carried by the push and stored on the feed row. */
  data?: Record<string, unknown>
  actorUserId?: string | null
  entityType?: string
  entityId?: string
  groupKey?: string
  dedupeKey?: string
}

export interface NotifyResult {
  /** The feed row, or null when the channel is `off` or there is no login. */
  notificationId: string | null
  /** The push outbox row, or null when the channel isn't `push`. */
  pushId: string | null
}

async function recipientUserId(
  tx: Prisma.TransactionClient,
  tenantId: string,
  r: NotifyRecipient,
): Promise<string | null> {
  if ('userId' in r) return r.userId
  const crew = await tx.crewMember.findFirst({
    where: { id: r.crewMemberId, tenantId },
    select: { tenantUserId: true },
  })
  return crew?.tenantUserId ?? null
}

export async function notify(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: NotifyInput,
): Promise<NotifyResult> {
  const userId = await recipientUserId(tx, tenantId, input.recipient)

  const pref = userId
    ? await tx.notificationPreference.findFirst({
        where: { tenantId, userId, type: input.type },
        select: { channel: true },
      })
    : null
  const channel = effectiveChannel(
    input.type,
    pref && isNotificationChannel(pref.channel) ? pref.channel : null,
  )
  const writes = channelWrites(channel)

  let notificationId: string | null = null
  if (userId && writes.feed) {
    const row = {
      tenantId,
      recipientUserId: userId,
      type: input.type,
      actorUserId: input.actorUserId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      title: input.title,
      body: input.body,
      data: (input.data ?? {}) as Prisma.InputJsonValue,
      groupKey: input.groupKey ?? null,
    }
    notificationId =
      input.dedupeKey != null
        ? (
            await tx.notification.upsert({
              where: { tenantId_dedupeKey: { tenantId, dedupeKey: input.dedupeKey } },
              create: { ...row, dedupeKey: input.dedupeKey },
              // A re-notify of the same event never resets seen / read.
              update: {},
              select: { id: true },
            })
          ).id
        : (await tx.notification.create({ data: row, select: { id: true } })).id
  }

  let pushId: string | null = null
  if (writes.push) {
    pushId = await enqueuePush(tx, tenantId, {
      ...input.recipient,
      payload: {
        title: input.title,
        body: input.body,
        ...(input.data !== undefined ? { data: input.data } : {}),
      },
      ...(input.dedupeKey != null ? { dedupeKey: input.dedupeKey } : {}),
    })
  }

  return { notificationId, pushId }
}
