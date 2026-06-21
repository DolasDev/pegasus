import { apiFetch } from './client'

// ---------------------------------------------------------------------------
// Tenant custom event types — mirror apps/api/src/handlers/event-types.ts.
//
// A tenant-defined event name a workflow EVENT trigger can subscribe to, beyond
// the five built-in DOMAIN_EVENT_TYPES. Optional payloadSchema (validated on
// emit) and domainCondition (auto-derive from a built-in event).
// ---------------------------------------------------------------------------

export interface TenantEventType {
  id: string
  tenantId: string
  name: string
  description: string | null
  /** Optional JSON-Schema subset validated on emit, else null. */
  payloadSchema: Record<string, unknown> | null
  /** Optional `{ sourceEventType, filter }` auto-derivation rule, else null. */
  domainCondition: Record<string, unknown> | null
  enabled: boolean
  createdByUserId: string
  createdAt: string
  updatedAt: string
}

export interface CreateEventTypeInput {
  name: string
  description?: string
  payloadSchema?: Record<string, unknown>
  domainCondition?: Record<string, unknown>
  enabled?: boolean
}

export interface UpdateEventTypeInput {
  description?: string | null
  payloadSchema?: Record<string, unknown> | null
  domainCondition?: Record<string, unknown> | null
  enabled?: boolean
}

// ---------------------------------------------------------------------------
// API calls — `/api/v1/event-types[/:name][/emit]`
// ---------------------------------------------------------------------------

/** List the tenant's custom event types, newest first. Requires
 * `event_type:manage`. */
export async function listEventTypes(): Promise<TenantEventType[]> {
  return apiFetch<TenantEventType[]>('/api/v1/event-types')
}

export async function getEventType(name: string): Promise<TenantEventType> {
  return apiFetch<TenantEventType>(`/api/v1/event-types/${encodeURIComponent(name)}`)
}

/** Register a custom event type (201). Requires `event_type:manage`. */
export async function createEventType(input: CreateEventTypeInput): Promise<TenantEventType> {
  return apiFetch<TenantEventType>('/api/v1/event-types', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** Partial-update a custom event type. Requires `event_type:manage`. */
export async function updateEventType(
  name: string,
  input: UpdateEventTypeInput,
): Promise<TenantEventType> {
  return apiFetch<TenantEventType>(`/api/v1/event-types/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

/** Hard-delete a custom event type (204). Subscribed triggers are left intact
 * (they simply stop matching). Requires `event_type:manage`. */
export async function deleteEventType(name: string): Promise<void> {
  await apiFetch<null>(`/api/v1/event-types/${encodeURIComponent(name)}`, { method: 'DELETE' })
}
