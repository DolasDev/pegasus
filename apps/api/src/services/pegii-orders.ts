// ---------------------------------------------------------------------------
// pegII order bridge — STUB.
//
// The authoritative "order" record lives in the legacy pegII (MoveManager)
// system, NOT in the cloud Postgres. (The cloud `/api/v1/orders` endpoint is a
// separate, move-backed integration view for M2M reporting clients — see
// handlers/orders.ts — and is deliberately left untouched.) A lifecycle
// workflow re-fetches authoritative order state from here, keyed by the order
// id carried in an `order.*` event envelope.
//
// This module is the seam, mirroring services/pegii-tasks.ts. Today it returns
// deterministic in-memory stub data so the SDK surface
// (PegasusClient.get_order / list_orders), the `ReadOrder` Cedar action, and the
// workflow author's activity can all be built and tested end to end. When the
// pegII order API is ready, replace the bodies below with calls into the pegII
// executor (handlers/pegii/ + repositories/pegii/generic.repository) — the
// exported signatures and the handler stay put, exactly like the longhaul
// cloud-cutover from on-prem MSSQL.
//
// The store is per-process and NON-DURABLE (a Lambda cold start resets it),
// which is fine for a stub: it keeps the contract honest without pretending to
// persist. Reads lazily materialise a deterministic record for any order id so
// a workflow started from an `order.booked` pointer always resolves something.
// ---------------------------------------------------------------------------

/** A pegII order record, in the shape the SDK/runtime surface exposes. */
export interface OrderRecord {
  id: string
  orderNumber: string
  status: 'booked' | 'in_progress' | 'completed'
  customerName: string | null
  scheduledDate: string | null
  packingActualDate: string | null
  createdAt: string
  updatedAt: string
}

/** Per-process store keyed by `${tenantId}:${orderId}`. */
const store = new Map<string, OrderRecord>()

function key(tenantId: string, orderId: string): string {
  return `${tenantId}:${orderId}`
}

/** Lazily materialise a deterministic order record for `orderId`. */
function ensureOrder(tenantId: string, orderId: string): OrderRecord {
  const k = key(tenantId, orderId)
  let record = store.get(k)
  if (!record) {
    const now = new Date().toISOString()
    record = {
      id: orderId,
      orderNumber: `SO-${orderId}`,
      status: 'booked',
      customerName: null,
      scheduledDate: null,
      packingActualDate: null,
      createdAt: now,
      updatedAt: now,
    }
    store.set(k, record)
  }
  return record
}

/** Fetch one order by id. Materialised on first read (stub behaviour). */
export function getOrder(tenantId: string, orderId: string): OrderRecord {
  return ensureOrder(tenantId, orderId)
}

/** List orders, optionally filtered by status. */
export function listOrders(tenantId: string, opts: { status?: string } = {}): OrderRecord[] {
  const prefix = `${tenantId}:`
  let records = [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v)
  if (opts.status) {
    records = records.filter((r) => r.status === opts.status)
  }
  return records
}

/** Test seam — clear the in-memory store between cases. */
export function _resetOrderStore(): void {
  store.clear()
}
