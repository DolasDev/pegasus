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

export type TripAssignmentPushInput = {
  /** Legacy TripMaster id — the deep-link target (`/trip/[id]` in the app). */
  tripId: number
  /** v_longhaul_drivers.driver_id of the newly assigned driver. */
  longhaulDriverId: number
}

/**
 * Enqueues a "you've been assigned a trip" push for the driver a longhaul trip
 * was just assigned to (see handlers/longhaul-cloud/trip-save).
 *
 * Longhaul is the system drivers actually work out of, so the target is a
 * legacy `driver_id` rather than a cloud CrewMember. It resolves to a login via
 * `TenantUser.longhaulDriverId` — the same mapping `/api/v1/me/driver` uses to
 * scope My Trips. That mapping is set by a tenant admin and is nullable, so an
 * unmapped driver is a silent no-op (returns false): they can't see the trip in
 * the app either, so there is nothing to notify them about.
 *
 * Dedupe is per (trip, driver): saving the same trip repeatedly — the common
 * case, since every trip edit re-saves the header — can never double-notify.
 * The tradeoff is that reassigning A → B → A won't re-notify A; duplicate
 * suppression is the more valuable half of that trade.
 *
 * Returns whether a row was enqueued, so the caller can log the unmapped case.
 */
export async function enqueueTripAssignmentPush(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: TripAssignmentPushInput,
): Promise<boolean> {
  const user = await tx.tenantUser.findFirst({
    where: {
      tenantId,
      longhaulDriverId: input.longhaulDriverId,
      // A revoked login has no business receiving work, and a service account
      // is not a person holding a phone.
      isServiceAccount: false,
      status: { not: 'DEACTIVATED' },
    },
    select: { id: true },
  })
  if (!user) return false

  await enqueuePush(tx, tenantId, {
    userId: user.id,
    dedupeKey: `trip.assigned:${input.tripId}:${input.longhaulDriverId}`,
    payload: {
      title: 'New trip assigned',
      body: 'You have been assigned to a trip. Tap to view the details.',
      data: { type: 'trip.assigned', tripId: input.tripId },
    },
  })
  return true
}
