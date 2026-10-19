// ---------------------------------------------------------------------------
// Push-notification outbox repository — reliable delivery persistence.
//
// Mirrors the MessageForwardOutbox pattern (messaging.repository): callers
// enqueue one row per logical notification inside the same transaction as the
// state change that prompted it; the push forwarder (lambda-push-forward) drains
// due rows, sends via the Expo adapter, and records the outcome with exponential
// backoff + dead-lettering.
//
// Targeting: exactly one of userId / crewMemberId is set. A crew target resolves
// to that member's linked TenantUser (CrewMember.tenantUserId) at drain time —
// `listPendingPush` includes the link so the forwarder needn't re-query.
// ---------------------------------------------------------------------------

import type { PrismaClient, Prisma, ForwardStatus } from '@prisma/client'

/** The generic notification envelope persisted in the `payload` JSON column. */
export type PushPayloadJson = {
  title: string
  body: string
  data?: Record<string, unknown>
}

export type EnqueuePushInput = {
  /** Target a TenantUser directly... */
  userId?: string
  /** ...or a CrewMember (resolved to its linked TenantUser at drain time). */
  crewMemberId?: string
  payload: PushPayloadJson
  /**
   * Optional idempotency key (unique per tenant). A retried enqueue for the same
   * logical event collapses to the existing row instead of duplicating the send.
   */
  dedupeKey?: string
}

/**
 * Enqueues a push notification. When `dedupeKey` is provided the write is
 * idempotent (upsert on (tenantId, dedupeKey), leaving an existing row's
 * delivery state untouched); otherwise a fresh row is created. Accepts an
 * interactive-transaction client so domain emitters can enqueue atomically with
 * their state change (cf. emitDomainEvent). Returns the row id.
 */
export async function enqueuePush(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: EnqueuePushInput,
): Promise<string> {
  const payload = input.payload as unknown as Prisma.InputJsonValue
  const target = {
    ...(input.userId != null ? { userId: input.userId } : {}),
    ...(input.crewMemberId != null ? { crewMemberId: input.crewMemberId } : {}),
  }

  if (input.dedupeKey != null) {
    const row = await tx.pushNotificationOutbox.upsert({
      where: { tenantId_dedupeKey: { tenantId, dedupeKey: input.dedupeKey } },
      create: { tenantId, payload, dedupeKey: input.dedupeKey, ...target },
      // Re-enqueue of the same logical event is a no-op — never resets delivery.
      update: {},
      select: { id: true },
    })
    return row.id
  }

  const row = await tx.pushNotificationOutbox.create({
    data: { tenantId, payload, ...target },
    select: { id: true },
  })
  return row.id
}

/**
 * Drains the next batch of due notifications across all tenants. PENDING (never
 * sent, or parked) and FAILED (a prior attempt failed and the backoff elapsed)
 * are retryable; SENT is terminal and DEAD only re-opens via manual redrive.
 * Includes the crew→user link so the forwarder can resolve crew targets without
 * a second query. Base client (cross-tenant cron context).
 */
export async function listPendingPush(db: PrismaClient, limit: number, now: Date = new Date()) {
  return db.pushNotificationOutbox.findMany({
    where: { status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
    include: { crewMember: { select: { tenantUserId: true } } },
  })
}

/** How long a claimed row stays invisible to other drainers. */
export const PUSH_CLAIM_LEASE_MS = 2 * 60_000

/**
 * Claims one row for delivery so two drainers never send it twice — the
 * scheduled forwarder run and a kicked one (move chat), or two overlapping runs. A compare-and-set: the row
 * is pushed `PUSH_CLAIM_LEASE_MS` into the future ONLY if its `nextAttemptAt` is
 * still the value the caller read. Postgres re-checks an UPDATE's WHERE against
 * the latest row version, so of two concurrent claims exactly one matches.
 * Returns whether this caller won. If the claimant dies mid-send, the lease
 * expires and the row is due again.
 */
export async function claimPush(
  db: PrismaClient,
  row: { id: string; nextAttemptAt: Date },
  now: Date = new Date(),
): Promise<boolean> {
  const { count } = await db.pushNotificationOutbox.updateMany({
    where: {
      id: row.id,
      status: { in: ['PENDING', 'FAILED'] },
      nextAttemptAt: row.nextAttemptAt,
    },
    data: { nextAttemptAt: new Date(now.getTime() + PUSH_CLAIM_LEASE_MS) },
  })
  return count === 1
}

/** Marks a notification delivered (accepted by Expo); records the first ticket id. */
export async function markPushSent(
  db: PrismaClient,
  id: string,
  ticketId: string | null,
): Promise<void> {
  await db.pushNotificationOutbox.update({
    where: { id },
    data: { status: 'SENT', lastError: null, ...(ticketId ? { expoTicketId: ticketId } : {}) },
  })
}

/**
 * Records a failed attempt. `nextStatus` is FAILED for a retry (with a future
 * backoff) or DEAD when retries are exhausted. Increments the attempt counter.
 */
export async function markPushFailed(
  db: PrismaClient,
  id: string,
  args: {
    nextStatus: Extract<ForwardStatus, 'FAILED' | 'DEAD'>
    error: string
    nextAttemptAt: Date
  },
): Promise<void> {
  await db.pushNotificationOutbox.update({
    where: { id },
    data: {
      status: args.nextStatus,
      lastError: args.error,
      nextAttemptAt: args.nextAttemptAt,
      attempts: { increment: 1 },
    },
  })
}
