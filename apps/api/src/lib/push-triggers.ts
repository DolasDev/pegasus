// ---------------------------------------------------------------------------
// Push-notification triggers — the seam between domain events and the outbox.
//
// This is the SINGLE place notification copy + tap-action (deep link) for
// system-initiated pushes lives. Handlers/domain emitters call these helpers
// inside their own transaction so the push enqueue commits atomically with the
// state change that prompted it (true outbox — no dual-write). The actual
// delivery is done later by the scheduled push-forward Lambda.
//
// Content here is intentionally minimal/generic for the infrastructure cut —
// refine titles/bodies/categories/actions without touching the plumbing. The
// `data` block is the deep-link contract the mobile app reads on notification
// tap (see apps/mobile push tap handler): `{ type, ...targetIds }`.
// ---------------------------------------------------------------------------

import type { Prisma } from '@prisma/client'
import { enqueuePush } from '../repositories/push-outbox.repository'

export type CrewAssignmentPushInput = {
  moveId: string
  crewMemberId: string
}

/**
 * Enqueues a "you've been assigned to a move" push for the assigned crew member.
 * Idempotent per (move, crew) via the dedupeKey, so re-running the idempotent
 * assignment upsert never produces a duplicate notification. The deep link
 * targets the order detail screen (`/order/[id]`).
 */
export async function enqueueCrewAssignmentPush(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: CrewAssignmentPushInput,
): Promise<void> {
  await enqueuePush(tx, tenantId, {
    crewMemberId: input.crewMemberId,
    dedupeKey: `move.assigned:${input.moveId}:${input.crewMemberId}`,
    payload: {
      title: 'New assignment',
      body: 'You have been assigned to a move. Tap to view the details.',
      data: { type: 'move.assigned', moveId: input.moveId },
    },
  })
}
