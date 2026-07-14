// ---------------------------------------------------------------------------
// pegII task bridge — STUB.
//
// Operational "tasks" (date confirmation, survey scheduling, paperwork, QA
// sign-off) are the unit of human work in the moving-ops flow. They live in the
// legacy pegII (MoveManager) system, NOT in the cloud Postgres — the same way
// the retired longhaul surface read from on-prem MSSQL over WireGuard.
//
// This module is the seam. Today it returns deterministic, in-memory stub data
// so the SDK surface (PegasusClient.list_tasks / get_task / close_task), the
// Cedar actions (ReadTask / CloseTask), and the workflow author's activity can
// all be built and tested end to end. When the pegII task API is ready, replace
// the bodies below with calls into the pegII team's on-prem domain API over the
// tunnel, exactly as the order read was bridged (see gateways/pegii-order.gateway
// + the serialized endpoint) — the exported signatures and the handler stay put.
//
// The in-memory store is per-process and NON-DURABLE (a Lambda cold start
// resets it). That is intentional for a stub: it makes close_task idempotent
// within a run and keeps the contract honest without pretending to persist.
// ---------------------------------------------------------------------------

/** A pegII operational task, in the shape the SDK/tenant surface exposes. */
export interface TaskRecord {
  id: string
  orderId: string
  taskType: string
  status: 'open' | 'closed'
  reason: string | null
  createdAt: string
  updatedAt: string
  closedAt: string | null
}

/** Task types the stub seeds for every order (mirrors common pegII tasks). */
const SEEDED_TASK_TYPES = ['date_confirmation', 'survey_scheduling'] as const

/** Per-process store keyed by `${tenantId}:${orderId}:${taskType}`. */
const store = new Map<string, TaskRecord>()

function key(tenantId: string, orderId: string, taskType: string): string {
  return `${tenantId}:${orderId}:${taskType}`
}

function stableId(tenantId: string, orderId: string, taskType: string): string {
  // Deterministic id so repeated reads of the same task return a stable id
  // without a random source (and without leaking the tenant id).
  return `task_${orderId}_${taskType}`
}

/**
 * Ensure the seeded tasks exist for an order, then return the live record for
 * `(orderId, taskType)`. Seeding is lazy so a never-touched order costs nothing.
 */
function ensureSeeded(tenantId: string, orderId: string): TaskRecord[] {
  const now = new Date().toISOString()
  const records: TaskRecord[] = []
  for (const taskType of SEEDED_TASK_TYPES) {
    const k = key(tenantId, orderId, taskType)
    let record = store.get(k)
    if (!record) {
      record = {
        id: stableId(tenantId, orderId, taskType),
        orderId,
        taskType,
        status: 'open',
        reason: null,
        createdAt: now,
        updatedAt: now,
        closedAt: null,
      }
      store.set(k, record)
    }
    records.push(record)
  }
  return records
}

/** List tasks, optionally scoped to one order and/or a status. */
export function listTasks(
  tenantId: string,
  opts: { orderId?: string; status?: string } = {},
): TaskRecord[] {
  let records: TaskRecord[]
  if (opts.orderId) {
    records = ensureSeeded(tenantId, opts.orderId)
  } else {
    // No order scope: return every task this process has materialised for the
    // tenant. (A real pegII bridge would page a query here.)
    const prefix = `${tenantId}:`
    records = [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v)
  }
  if (opts.status) {
    records = records.filter((r) => r.status === opts.status)
  }
  return records
}

/** Fetch one task by its id. Returns null when unknown. */
export function getTask(tenantId: string, taskId: string): TaskRecord | null {
  const prefix = `${tenantId}:`
  for (const [k, v] of store.entries()) {
    if (k.startsWith(prefix) && v.id === taskId) return v
  }
  return null
}

/** Result of a close: the (now-closed) task plus whether it was already closed. */
export interface CloseResult {
  task: TaskRecord
  alreadyClosed: boolean
}

/**
 * Close an order's task by `(orderId, taskType)`. Idempotent — closing an
 * already-closed task is a no-op success with `alreadyClosed: true`.
 */
export function closeTask(
  tenantId: string,
  opts: { orderId: string; taskType: string; reason?: string | null },
): CloseResult {
  const { orderId, taskType } = opts
  ensureSeeded(tenantId, orderId)
  const k = key(tenantId, orderId, taskType)
  const existing = store.get(k)

  const now = new Date().toISOString()
  if (existing && existing.status === 'closed') {
    return { task: existing, alreadyClosed: true }
  }

  const base: TaskRecord = existing ?? {
    id: stableId(tenantId, orderId, taskType),
    orderId,
    taskType,
    status: 'open',
    reason: null,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  }
  const closed: TaskRecord = {
    ...base,
    status: 'closed',
    reason: opts.reason ?? base.reason,
    updatedAt: now,
    closedAt: now,
  }
  store.set(k, closed)
  return { task: closed, alreadyClosed: false }
}

/** Test seam — clear the in-memory store between cases. */
export function _resetTaskStore(): void {
  store.clear()
}
