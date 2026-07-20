// ---------------------------------------------------------------------------
// Messaging repository — RingCentral SMS capture persistence.
//
// Functions take a PrismaClient (base or tenant-scoped via createTenantDb) plus
// an explicit tenantId on writes, matching the repo convention. The background
// capture/forward/cron paths use the base client and resolve tenant from the
// subscription/connection/row; tenant API handlers may use the scoped client.
//
// The capture primitive (`captureMessage`) is idempotent on
// (tenantId, source, externalId) — webhook-path and sync-path upserts converge
// on it, and the per-message outbox row is enqueued exactly once.
// ---------------------------------------------------------------------------

import type { PrismaClient, Prisma } from '@prisma/client'
import type { Message, NormalizedMessage, ForwardStatus, PhoneNumber } from '@pegasus/domain'
import { toMessageId, toSmsThreadId, deriveMessageStatus } from '@pegasus/domain'

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

type RawMessage = Prisma.MessageGetPayload<Record<string, never>>

/** Maps a persisted message row to the domain Message aggregate. */
export function mapMessage(row: RawMessage): Message {
  return {
    id: toMessageId(row.id),
    source: row.source,
    externalId: row.externalId,
    direction: row.direction,
    // Numbers were E.164-validated by the domain normalizer at capture time;
    // cast on read rather than re-running the throwing factory, so a read path
    // can never 500 on a stored value (cf. toMessageId — unchecked coercion).
    fromNumber: row.fromNumber as PhoneNumber,
    toNumber: row.toNumber as PhoneNumber,
    status: row.status,
    forwardStatus: row.forwardStatus,
    rcCreationTime: row.rcCreationTime,
    ...(row.threadId != null ? { threadId: toSmsThreadId(row.threadId) } : {}),
    ...(row.body != null ? { body: row.body } : {}),
    ...(row.rcLastModifiedTime != null ? { rcLastModifiedTime: row.rcLastModifiedTime } : {}),
  }
}

// ---------------------------------------------------------------------------
// RingCentralConnection
// ---------------------------------------------------------------------------

export type CreateConnectionInput = {
  rcAccountId: string
  rcExtensionId: string
  ownerNumber: string
  scopes?: string[]
  tokenSecretArn?: string
}

/** Creates (or returns the existing) connection for a tenant + account/extension. */
export async function upsertConnection(
  db: PrismaClient,
  tenantId: string,
  input: CreateConnectionInput,
) {
  return db.ringCentralConnection.upsert({
    where: {
      tenantId_rcAccountId_rcExtensionId: {
        tenantId,
        rcAccountId: input.rcAccountId,
        rcExtensionId: input.rcExtensionId,
      },
    },
    create: {
      tenantId,
      rcAccountId: input.rcAccountId,
      rcExtensionId: input.rcExtensionId,
      ownerNumber: input.ownerNumber,
      scopes: input.scopes ?? [],
      ...(input.tokenSecretArn != null ? { tokenSecretArn: input.tokenSecretArn } : {}),
    },
    update: {
      ownerNumber: input.ownerNumber,
      ...(input.scopes != null ? { scopes: input.scopes } : {}),
      ...(input.tokenSecretArn != null ? { tokenSecretArn: input.tokenSecretArn } : {}),
    },
  })
}

export async function findConnectionById(db: PrismaClient, id: string) {
  return db.ringCentralConnection.findUnique({ where: { id } })
}

/** Lists a tenant's connections (oldest first) for the Settings UI. Tenant-scoped. */
export async function listConnectionsByTenant(db: PrismaClient, tenantId: string) {
  return db.ringCentralConnection.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
  })
}

/**
 * Deletes a tenant's connection by id and returns the number of rows removed.
 * Uses deleteMany (not delete) so it is idempotent + tenant-safe: a foreign or
 * missing id matches nothing and returns 0 rather than throwing. The Prisma
 * cascade drops the connection's subscriptions + sync cursors; Message rows are
 * `onDelete: SetNull` so captured messages are retained.
 */
export async function deleteConnectionForTenant(db: PrismaClient, tenantId: string, id: string) {
  const { count } = await db.ringCentralConnection.deleteMany({ where: { id, tenantId } })
  return count
}

/**
 * Lists all connections with a usable token across every tenant: ACTIVE status
 * AND a stored refresh-token secret. The `tokenSecretArn != null` guard means a
 * connection whose OAuth row was created but whose secret write failed mid-connect
 * is never picked up by the token-refresh/sync crons (which would otherwise crash
 * trying to read a missing secret). Base-client / cross-tenant.
 */
export async function listActiveConnections(db: PrismaClient) {
  return db.ringCentralConnection.findMany({
    where: { tokenStatus: 'ACTIVE', tokenSecretArn: { not: null } },
  })
}

/** Records a successful token refresh (and rotation of the stored secret ARN). */
export async function markTokenRefreshed(
  db: PrismaClient,
  id: string,
  refreshedAt: Date,
  tokenSecretArn?: string,
) {
  return db.ringCentralConnection.update({
    where: { id },
    data: {
      tokenStatus: 'ACTIVE',
      health: 'HEALTHY',
      lastRefreshedAt: refreshedAt,
      ...(tokenSecretArn != null ? { tokenSecretArn } : {}),
    },
  })
}

/** Marks a connection's token as expired and the connection unhealthy. */
export async function markTokenExpired(db: PrismaClient, id: string) {
  return db.ringCentralConnection.update({
    where: { id },
    data: { tokenStatus: 'EXPIRED', health: 'UNHEALTHY' },
  })
}

export async function updateConnectionHealth(
  db: PrismaClient,
  id: string,
  health: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY',
) {
  return db.ringCentralConnection.update({ where: { id }, data: { health } })
}

// ---------------------------------------------------------------------------
// RingCentralSubscription
// ---------------------------------------------------------------------------

export type UpsertSubscriptionInput = {
  connectionId: string
  subscriptionId: string
  eventFilters: string[]
  deliveryAddress: string
  verificationToken: string
  expiresAt: Date
  transport?: string
}

/** Creates or updates the managed subscription, keyed on the RC subscriptionId. */
export async function upsertSubscription(
  db: PrismaClient,
  tenantId: string,
  input: UpsertSubscriptionInput,
) {
  return db.ringCentralSubscription.upsert({
    where: { subscriptionId: input.subscriptionId },
    create: {
      tenantId,
      connectionId: input.connectionId,
      subscriptionId: input.subscriptionId,
      eventFilters: input.eventFilters,
      deliveryAddress: input.deliveryAddress,
      verificationToken: input.verificationToken,
      expiresAt: input.expiresAt,
      ...(input.transport != null ? { transport: input.transport } : {}),
      status: 'ACTIVE',
      lastRenewedAt: new Date(),
    },
    update: {
      eventFilters: input.eventFilters,
      deliveryAddress: input.deliveryAddress,
      verificationToken: input.verificationToken,
      expiresAt: input.expiresAt,
      status: 'ACTIVE',
      failureCount: 0,
      lastRenewedAt: new Date(),
    },
  })
}

/**
 * Resolves a subscription by the RingCentral subscriptionId carried in a webhook
 * payload. Base-client — the webhook runs pre-tenant and uses the returned
 * tenantId/connectionId to load the tenant-scoped client.
 */
export async function findSubscriptionByRcId(db: PrismaClient, subscriptionId: string) {
  return db.ringCentralSubscription.findUnique({ where: { subscriptionId } })
}

/** Returns the most-recently-created subscription for a connection, if any. */
export async function findSubscriptionByConnection(db: PrismaClient, connectionId: string) {
  return db.ringCentralSubscription.findFirst({
    where: { connectionId },
    orderBy: { createdAt: 'desc' },
  })
}

/** Deletes a subscription row (used after recreating a blacklisted/dead one). */
export async function deleteSubscription(db: PrismaClient, id: string) {
  await db.ringCentralSubscription.delete({ where: { id } })
}

/**
 * Lists subscriptions due for renewal: ACTIVE/EXPIRING and expiring before
 * `before`, or any in a recreate-worthy state (BLACKLISTED/DEAD). Base-client.
 */
export async function listSubscriptionsToRenew(db: PrismaClient, before: Date) {
  return db.ringCentralSubscription.findMany({
    where: {
      OR: [
        { status: { in: ['ACTIVE', 'EXPIRING'] }, expiresAt: { lte: before } },
        { status: { in: ['BLACKLISTED', 'DEAD'] } },
      ],
    },
  })
}

export type SubscriptionUpdate = {
  status?: 'ACTIVE' | 'EXPIRING' | 'BLACKLISTED' | 'DEAD'
  expiresAt?: Date
  lastRenewedAt?: Date
  failureCount?: number
}

export async function updateSubscription(db: PrismaClient, id: string, patch: SubscriptionUpdate) {
  return db.ringCentralSubscription.update({
    where: { id },
    data: {
      ...(patch.status != null ? { status: patch.status } : {}),
      ...(patch.expiresAt != null ? { expiresAt: patch.expiresAt } : {}),
      ...(patch.lastRenewedAt != null ? { lastRenewedAt: patch.lastRenewedAt } : {}),
      ...(patch.failureCount != null ? { failureCount: patch.failureCount } : {}),
    },
  })
}

// ---------------------------------------------------------------------------
// RingCentralSyncCursor
// ---------------------------------------------------------------------------

export async function getSyncCursor(
  db: PrismaClient,
  tenantId: string,
  connectionId: string,
  store: 'THREAD' | 'V1',
) {
  return db.ringCentralSyncCursor.findUnique({
    where: { tenantId_connectionId_store: { tenantId, connectionId, store } },
  })
}

/** Persists the latest sync token for a store and stamps lastSyncAt. */
export async function saveSyncCursor(
  db: PrismaClient,
  tenantId: string,
  connectionId: string,
  store: 'THREAD' | 'V1',
  syncToken: string,
  syncedAt: Date = new Date(),
) {
  return db.ringCentralSyncCursor.upsert({
    where: { tenantId_connectionId_store: { tenantId, connectionId, store } },
    create: { tenantId, connectionId, store, syncToken, lastSyncAt: syncedAt },
    update: { syncToken, lastSyncAt: syncedAt },
  })
}

// ---------------------------------------------------------------------------
// InboundWebhookEvent
// ---------------------------------------------------------------------------

export type RecordWebhookEventInput = {
  subscriptionId?: string
  connectionId?: string
  rawPayload: Prisma.InputJsonValue
  headers: Prisma.InputJsonValue
}

/** Persists a raw webhook event to the inbox (fast-ack path). Returns its id. */
export async function recordWebhookEvent(
  db: PrismaClient,
  tenantId: string,
  input: RecordWebhookEventInput,
): Promise<string> {
  const row = await db.inboundWebhookEvent.create({
    data: {
      tenantId,
      rawPayload: input.rawPayload,
      headers: input.headers,
      ...(input.subscriptionId != null ? { subscriptionId: input.subscriptionId } : {}),
      ...(input.connectionId != null ? { connectionId: input.connectionId } : {}),
    },
    select: { id: true },
  })
  return row.id
}

export async function markWebhookEventProcessed(db: PrismaClient, id: string) {
  return db.inboundWebhookEvent.update({
    where: { id },
    data: { status: 'PROCESSED', processedAt: new Date() },
  })
}

export async function markWebhookEventFailed(db: PrismaClient, id: string, error: string) {
  return db.inboundWebhookEvent.update({
    where: { id },
    data: { status: 'FAILED', processedAt: new Date(), error },
  })
}

// ---------------------------------------------------------------------------
// Message + transactional outbox
// ---------------------------------------------------------------------------

/**
 * Idempotently captures a normalized SMS: upserts the Message on
 * (tenantId, source, externalId) and ensures exactly one outbox row exists for
 * on-prem forwarding. Safe to call repeatedly from the webhook path and the
 * safety-net sync — both converge on the same row, and the outbox enqueue is a
 * no-op when a row already exists (so an already-SENT message is not re-queued).
 */
export async function captureMessage(
  db: PrismaClient,
  tenantId: string,
  normalized: NormalizedMessage,
  connectionId?: string,
): Promise<Message> {
  // An SMS's text/direction/parties are immutable for a given RC message id, so
  // they are written only on create. Re-capture (webhook + safety-net sync
  // converging) refreshes only thread metadata — crucially NOT `body`, so a
  // message whose body was purged after forwarding is never resurrected.
  const onReCapture = {
    ...(normalized.threadId != null ? { threadId: normalized.threadId } : {}),
    ...(normalized.rcLastModifiedTime != null
      ? { rcLastModifiedTime: normalized.rcLastModifiedTime }
      : {}),
    ...(connectionId != null ? { connectionId } : {}),
  }

  const row = await db.$transaction(async (tx) => {
    const message = await tx.message.upsert({
      where: {
        tenantId_source_externalId: {
          tenantId,
          source: normalized.source,
          externalId: normalized.externalId,
        },
      },
      create: {
        tenantId,
        source: normalized.source,
        externalId: normalized.externalId,
        direction: normalized.direction,
        fromNumber: normalized.fromNumber,
        toNumber: normalized.toNumber,
        rcCreationTime: normalized.rcCreationTime,
        ...(normalized.body != null ? { body: normalized.body } : {}),
        ...(connectionId != null ? { connectionId } : {}),
        ...onReCapture,
      },
      update: onReCapture,
    })

    // Ensure a single outbox row. update:{} keeps an already-SENT/FAILED row
    // untouched, so re-capture never re-queues or resets delivery state.
    await tx.messageForwardOutbox.upsert({
      where: { messageId: message.id },
      create: { tenantId, messageId: message.id },
      update: {},
    })

    return message
  })

  return mapMessage(row)
}

/**
 * Drains the next batch of forwardable outbox rows that are due across all
 * tenants, with their messages. Both PENDING (never delivered, or parked after a
 * transient on-prem outage) and FAILED (a prior attempt failed and the backoff
 * has elapsed) are retryable — matching domain `canForward`; SENT is terminal and
 * DEAD only re-opens via an explicit manual redrive. The `nextAttemptAt <= now`
 * clause enforces the backoff. Base-client — the forwarder cron resolves the
 * tenant's on-prem connection string per row.
 */
export async function listPendingForwards(db: PrismaClient, limit: number, now: Date = new Date()) {
  return db.messageForwardOutbox.findMany({
    where: { status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
    include: { message: true },
  })
}

/**
 * Parks a forward for a later retry WITHOUT consuming a delivery attempt: keeps
 * the row PENDING and pushes out `nextAttemptAt`. Used when the failure is the
 * on-prem side being unreachable/unconfigured (an infra outage, not a bad
 * message), so a long outage can't dead-letter the whole backlog — the rows just
 * wait. `attempts` is deliberately left untouched and the message's forwardStatus
 * stays PENDING/CAPTURED.
 */
export async function parkForward(
  db: PrismaClient,
  outboxId: string,
  nextAttemptAt: Date,
  error: string,
) {
  return db.messageForwardOutbox.update({
    where: { id: outboxId },
    data: { status: 'PENDING', nextAttemptAt, lastError: error },
  })
}

/**
 * Marks a forward as delivered: outbox + message → SENT/FORWARDED, and stamps
 * `purgeAfter` so the buffer-purge cron can null the PII body after the window.
 */
export async function markForwardSent(
  db: PrismaClient,
  outboxId: string,
  messageId: string,
  purgeAfter: Date,
) {
  await db.$transaction([
    db.messageForwardOutbox.update({
      where: { id: outboxId },
      data: { status: 'SENT', lastError: null },
    }),
    db.message.update({
      where: { id: messageId },
      data: {
        forwardStatus: 'SENT',
        status: deriveMessageStatus('SENT'),
        purgeAfter,
      },
    }),
  ])
}

// ---------------------------------------------------------------------------
// Buffer-purge — PII retention (Unit 14)
//
// Neon is a transient buffer; the on-prem SQL Server is the authoritative store
// once a message is SENT. These are bulk, cross-tenant (base-client) sweeps run
// by the buffer-purge cron.
// ---------------------------------------------------------------------------

/**
 * Nulls the PII body (and stamps `bodyPurgedAt`) of every forwarded message
 * whose 72h purge window has elapsed. `bodyPurgedAt: null` makes it idempotent —
 * an already-purged row is skipped, and captureMessage never rewrites a body on
 * re-capture, so a purged body is never resurrected. Returns the rows purged.
 */
export async function purgeForwardedBodies(db: PrismaClient, now: Date = new Date()) {
  const { count } = await db.message.updateMany({
    where: { forwardStatus: 'SENT', purgeAfter: { lte: now }, bodyPurgedAt: null },
    data: { body: null, bodyPurgedAt: now },
  })
  return count
}

/**
 * Hard-deletes forwarded message tombstones captured before `olderThan`. Only
 * SENT rows (durable on-prem) are removed — PENDING/FAILED rows are still being
 * delivered and DEAD rows are kept for investigation. The FK cascade drops each
 * deleted message's outbox row. Returns the rows deleted.
 */
export async function hardDeleteForwarded(db: PrismaClient, olderThan: Date) {
  const { count } = await db.message.deleteMany({
    where: { forwardStatus: 'SENT', capturedAt: { lt: olderThan } },
  })
  return count
}

/**
 * Records a failed forward attempt. `nextStatus` is FAILED for a retry (with a
 * future `nextAttemptAt` backoff) or DEAD when retries are exhausted; the
 * message's forwardStatus is kept in lock-step.
 */
export async function markForwardFailed(
  db: PrismaClient,
  outboxId: string,
  messageId: string,
  args: {
    nextStatus: Extract<ForwardStatus, 'FAILED' | 'DEAD'>
    error: string
    nextAttemptAt: Date
  },
) {
  await db.$transaction([
    db.messageForwardOutbox.update({
      where: { id: outboxId },
      data: {
        status: args.nextStatus,
        lastError: args.error,
        nextAttemptAt: args.nextAttemptAt,
        attempts: { increment: 1 },
      },
    }),
    db.message.update({
      where: { id: messageId },
      data: {
        forwardStatus: args.nextStatus,
        status: deriveMessageStatus(args.nextStatus),
      },
    }),
  ])
}
