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

/**
 * Platform-provided INTEGRATION event types: legacy pegII / MoveManager events
 * that arrive over the integration EventBridge bus and are mapped to DomainEvents
 * by lambda-integration-event-map.ts. These are globally triggerable (every
 * tenant may build a WorkflowTrigger on them) but kept SEPARATE from the
 * DOMAIN_EVENT_TYPES platform taxonomy above — they are not emitted by Pegasus
 * domain writes, they're ingested from on-prem.
 *
 * Each name is the lowercased pegII catalogue DetailType under the `pegii.`
 * namespace (Shipment.Opened → pegii.shipment.opened). This list MUST stay in
 * sync with the mapper's deriveEventType output as the catalogue grows; the
 * `pegii.` prefix is reserved (see handlers/event-types.ts) so a tenant can't
 * register a colliding custom event. Catalogue source of truth:
 * GET /api/v1/pegii/events/catalogue.
 */
export const INTEGRATION_EVENT_TYPES = ['pegii.shipment.opened', 'pegii.shipment.closed'] as const

export type IntegrationEventType = (typeof INTEGRATION_EVENT_TYPES)[number]

/** Reserved event-name namespace owned by the integration pipeline. */
export const INTEGRATION_EVENT_TYPE_PREFIX = 'pegii.'

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

export type EmitTenantEventInput = {
  tenantId: string
  /** A tenant-defined custom event name (a TenantEventType.name). Unlike the
   * platform taxonomy above this is an arbitrary string, NOT a DomainEventType. */
  eventType: string
  payload: Record<string, unknown>
}

/**
 * Appends one row to the SAME domain-event outbox as emitDomainEvent, but for a
 * tenant-defined CUSTOM event type. Kept separate so platform emitters stay
 * compile-time typed against DomainEventType while this path accepts the open
 * string set of the tenant registry.
 *
 * The eventType is NOT validated against any allowlist here — callers (the emit
 * handler, the dispatcher's domain-condition deriver) validate against the
 * tenant's TenantEventType registry before calling. Same transaction contract
 * as emitDomainEvent: pass the `tx` from `db.$transaction(...)` so the outbox
 * row commits or rolls back with its surrounding write.
 */
export async function emitTenantEvent(
  tx: Prisma.TransactionClient,
  input: EmitTenantEventInput,
): Promise<void> {
  await tx.domainEvent.create({
    data: {
      tenantId: input.tenantId,
      eventType: input.eventType,
      payload: input.payload as Prisma.InputJsonValue,
    },
  })
}
