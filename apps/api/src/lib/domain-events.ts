// ---------------------------------------------------------------------------
// Domain-event outbox — canonical event taxonomy + transactional emit helper.
//
// emitDomainEvent() writes a DomainEvent row via the caller's Prisma client.
// Callers MUST invoke it inside the same transaction as the domain state
// change it describes — atomicity comes from the caller's transaction, not
// from this helper. Nothing consumes the table yet; the Phase 3 trigger
// dispatcher will drain undispatched rows (see prisma/schema.prisma).
//
// The five launch event names are a PUBLIC CONTRACT (Phase 3 Resolved #4):
// additions are easy, renames are breaking. Add new event types here so this
// file stays the single source of truth for the taxonomy.
// ---------------------------------------------------------------------------

import type { Prisma } from '@prisma/client'

/** The five launch domain-event types. Renames are breaking — treat as API. */
export const DOMAIN_EVENT_TYPES = [
  'quote.accepted',
  'move.status_changed',
  'invoice.paid',
  'customer.created',
  'pegasus_event.received',
] as const

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number]

export type EmitDomainEventInput = {
  tenantId: string
  eventType: DomainEventType
  /** Entity ids + minimal context. Consumers refetch authoritative state. */
  payload: Record<string, unknown>
}

/**
 * Appends one row to the domain-event outbox using the given Prisma client.
 *
 * `tx` accepts either a plain client or an interactive-transaction client
 * (`Prisma.TransactionClient` is the structural subset both satisfy). Callers
 * thread the `tx` from `db.$transaction(async (tx) => ...)` so the outbox row
 * commits or rolls back together with the domain write.
 */
export async function emitDomainEvent(
  tx: Prisma.TransactionClient,
  input: EmitDomainEventInput,
): Promise<void> {
  await tx.domainEvent.create({
    data: {
      tenantId: input.tenantId,
      eventType: input.eventType,
      payload: input.payload as Prisma.InputJsonValue,
    },
  })
}
