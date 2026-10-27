// ---------------------------------------------------------------------------
// My Crew auto-assign — when dispatch accepts a longhaul trip, each driver's
// "Every job" members go onto that driver's labor activities on the trip.
//
// Called by PATCH /onprem/longhaul/trips/:id/status (handlers/longhaul-cloud/
// trips-write.ts) after the status write commits on-prem, for a confirm
// transition only (isTripConfirmTransition: Pending/Offered → Accepted/
// In-Progress). The assignments and the `trip.accepted` domain event commit in
// ONE Postgres transaction, so an Automation subscribed to the event always
// sees the labor it describes. The status itself lives in MSSQL and cannot join
// that transaction, which is why this is a direct call rather than a consumer
// of the event: there is no internal subscriber to hang it on, and the event
// can't be atomic with a write in another database anyway.
//
// Per activity, the crew is its OWNER's (activityOwnerDriverId — the Labor
// tab's rule: assigned driver, else the trip's driver), mapped to logins via
// TenantUser.longhaulDriverId like the trip-assignment push. Only labor types
// count (isLaborActivityType). Additive only: rows that exist are skipped and
// nothing is removed, so a member the driver unticked after acceptance stays
// unticked — unless the trip goes back to Offered and is accepted again.
// A failed lookup or assign still emits the event (assignFailed); there is no
// retry — the driver ticks members by hand on the Labor tab.
// Plan: plans/completed/65abbd34-my-crew.md.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import { isLaborActivityType } from '@pegasus/domain'
import { emitDomainEvent } from './domain-events'
import { logger } from './logger'
import { activityOwnerDriverId, tripActivities } from './longhaul-driver-activity'

export interface TripAcceptedInput {
  tenantId: string
  connectionString: string
  tripId: number
  /** The trip's driver (TripMaster.driver_id), for the event payload. */
  driverId: number | null
  fromStatusId: number
  toStatusId: number
}

export interface AutoAssigned {
  activityId: number
  memberIds: string[]
}

/** Which Every-job members go on which of the trip's labor activities. */
async function planAssignments(db: PrismaClient, input: TripAcceptedInput) {
  const { tenantId } = input
  const activities = (await tripActivities(input.connectionString, input.tripId)).filter((a) =>
    isLaborActivityType(a.ActivityType_code),
  )
  const owners = [
    ...new Set(activities.map(activityOwnerDriverId).filter((d): d is number => d != null)),
  ]

  // TenantUser is not auto-scoped by the tenant client — name the tenant.
  const users = owners.length
    ? await db.tenantUser.findMany({
        where: {
          tenantId,
          longhaulDriverId: { in: owners },
          isServiceAccount: false,
          status: { not: 'DEACTIVATED' },
        },
        select: { id: true, longhaulDriverId: true },
      })
    : []
  const members = users.length
    ? await db.driverCrewMember.findMany({
        where: { tenantUserId: { in: users.map((u) => u.id) }, everyJob: true, removedAt: null },
        select: { id: true, tenantUserId: true },
      })
    : []
  const driverOf = new Map(users.map((u) => [u.id, u.longhaulDriverId]))
  const byDriver = new Map<number, string[]>()
  for (const m of members) {
    const driver = driverOf.get(m.tenantUserId)
    if (driver != null) byDriver.set(driver, [...(byDriver.get(driver) ?? []), m.id])
  }

  return activities
    .map((a) => ({
      activity: a,
      memberIds: byDriver.get(activityOwnerDriverId(a) ?? -1) ?? [],
    }))
    .filter((x) => x.memberIds.length > 0)
}

/**
 * Adds the trip's drivers' Every-job members to its labor activities and emits
 * `trip.accepted`, in one transaction. Returns what was assigned
 * (already-present rows included).
 *
 * The acceptance itself is already committed on-prem, so the event must not
 * hang on the labor half: when the legacy read or the assign fails, it is
 * logged and the event is still emitted alone, with `assigned: []` and
 * `assignFailed: true`. Throws only when even that emit fails.
 */
export async function autoAssignOnTripAccepted(
  db: PrismaClient,
  input: TripAcceptedInput,
): Promise<AutoAssigned[]> {
  const { tenantId } = input
  const event = (assigned: AutoAssigned[], assignFailed: boolean) => ({
    tenantId,
    eventType: 'trip.accepted' as const,
    payload: {
      tripId: input.tripId,
      driverId: input.driverId,
      fromStatusId: input.fromStatusId,
      toStatusId: input.toStatusId,
      assigned,
      ...(assignFailed ? { assignFailed: true } : {}),
    },
  })
  try {
    const plan = await planAssignments(db, input)
    const assigned = plan.map((x) => ({ activityId: x.activity.id, memberIds: x.memberIds }))
    await db.$transaction(async (tx) => {
      if (plan.length > 0) {
        await tx.activityLaborMember.createMany({
          data: plan.flatMap(({ activity, memberIds }) =>
            memberIds.map((memberId) => ({
              tenantId,
              activityId: activity.id,
              orderNum: activity.order_num,
              memberId,
              assignedByUserId: null,
            })),
          ),
          skipDuplicates: true,
        })
      }
      await emitDomainEvent(tx, event(assigned, false))
    })
    return assigned
  } catch (err) {
    logger.warn('labor auto-assign failed — emitting trip.accepted without it', {
      error: String(err),
      tripId: input.tripId,
    })
    await emitDomainEvent(db, event([], true))
    return []
  }
}
