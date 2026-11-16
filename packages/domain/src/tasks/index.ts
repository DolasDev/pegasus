// ---------------------------------------------------------------------------
// Tasks — the driver To Do, computed from state (task queue plan, TQ-D1).
//
// A rule reads the current facts and produces the tasks that are still open.
// Nothing is stored: a task is gone the moment the data that satisfies it
// arrives (the act is marked done, the document is uploaded), so a driver never
// ticks a box for data entry. Snooze and dismiss are the only stored state, and
// they live in the API keyed by `TaskSpec.key`.
//
// Pure. Facts that could not be read are passed as `null` / `unknown`, and a
// rule that depends on them produces NOTHING rather than treating "unread" as
// "missing" — a failed read must never flood the list.
//
// Plan: plans/todo/task-queue-and-activity-feed.md §3 Phase 1.
// ---------------------------------------------------------------------------

/** The built-in driver rules. A tenant enables each one; all are off by default. */
export const DRIVER_TASK_RULES = [
  'submit-arrival-times',
  'submit-bol',
  'submit-weight-ticket',
] as const
export type DriverTaskRuleId = (typeof DRIVER_TASK_RULES)[number]

export function isDriverTaskRuleId(v: unknown): v is DriverTaskRuleId {
  return typeof v === 'string' && (DRIVER_TASK_RULES as readonly string[]).includes(v)
}

/** Human names for the rules, for settings screens. */
export const DRIVER_TASK_RULE_LABELS: Record<DriverTaskRuleId, string> = {
  'submit-arrival-times': 'Mark past and today’s acts done',
  'submit-bol': 'Upload the Bill of Lading after delivery',
  'submit-weight-ticket': 'Upload the weight ticket after a longhaul load',
}

/**
 * The act codes each document rule applies to (F2: a rule that fires on every
 * order is noise). Delivery = RDEL / XDEL (extra delivery); load = LOAD / R19O
 * (dock pickup out of storage) — the codes trip save generates and local jobs
 * reuse.
 */
export const BOL_ACT_CODES: ReadonlySet<string> = new Set(['RDEL', 'XDEL'])
export const WEIGHT_TICKET_ACT_CODES: ReadonlySet<string> = new Set(['LOAD', 'R19O'])

/** The document types (mobile `documentTypes.ts` values) that satisfy the rules. */
export const BOL_DOCUMENT_TYPE = 'bol'
export const WEIGHT_TICKET_DOCUMENT_TYPE = 'weight_ticket'

/** Where an act was read from — mirrors the itinerary's `source.kind`. */
export type TaskActSource = 'longhaul-activity' | 'local-job-token' | 'order-assigned'

/** One itinerary act, reduced to what the rules read. */
export interface TaskAct {
  /** The itinerary item key — stable across reads. */
  itemKey: string
  source: TaskActSource
  orderNum: number
  shipperName: string | null
  actCode: string | null
  actName: string
  /** `storage` = a SIT stay / warehouse act, never a driver task. */
  kind: 'act' | 'storage'
  /** False for a hand-typed local token the tenant's catalog doesn't know. */
  known: boolean
  /** The act's legacy day, `YYYY-MM-DD`. */
  day: string
  /** Dispatch recorded an actual in legacy. Always known (same read as the act). */
  legacyDone: boolean
  /**
   * The driver's own DONE fact: its day, `null` when there is none, or
   * `'unknown'` when the facts could not be read.
   */
  assertedDone: string | null | 'unknown'
}

export interface DriverTaskFacts {
  /** The driver's local day, `YYYY-MM-DD`. */
  today: string
  acts: readonly TaskAct[]
  /**
   * The ACTIVE document types on each order, or null when the documents could
   * not be read. An order with none is absent (or an empty set).
   */
  documentTypesByOrder: ReadonlyMap<number, ReadonlySet<string>> | null
  enabledRules: ReadonlySet<DriverTaskRuleId>
}

/** What tapping the task opens. */
export type TaskTarget =
  | { kind: 'mark-done'; itemKey: string; day: string }
  | { kind: 'upload-document'; orderNum: number; documentType: string }

export interface TaskSpec {
  /** `task:<rule>:<orderNum>:<itemKey | 'order'>` — stable across reads; snooze keys on it. */
  key: string
  rule: DriverTaskRuleId
  orderNum: number
  shipperName: string | null
  title: string
  /** `YYYY-MM-DD`. */
  due: string
  target: TaskTarget
}

export type TaskBucket = 'overdue' | 'today' | 'upcoming'

export function taskKey(rule: DriverTaskRuleId, orderNum: number, item: string): string {
  return `task:${rule}:${orderNum}:${item}`
}

/** A task's section on the To Do screen, from its due day and the driver's day. */
export function taskBucket(due: string, today: string): TaskBucket {
  if (due < today) return 'overdue'
  return due === today ? 'today' : 'upcoming'
}

/** Only acts a driver does at a customer, with a code the tenant knows. */
function isDriverAct(a: TaskAct): boolean {
  return a.kind === 'act' && a.known && a.actCode !== null
}

/** Done by legacy or by the driver; `'unknown'` when only the driver's word is missing. */
function doneState(a: TaskAct): boolean | 'unknown' {
  if (a.legacyDone) return true
  if (a.assertedDone === 'unknown') return 'unknown'
  return a.assertedDone !== null
}

function submitArrivalTimes(f: DriverTaskFacts): TaskSpec[] {
  const out: TaskSpec[] = []
  for (const a of f.acts) {
    if (!isDriverAct(a) || a.day > f.today) continue
    // Unknown ⇒ no task: unread facts are not "not done".
    if (doneState(a) !== false) continue
    out.push({
      key: taskKey('submit-arrival-times', a.orderNum, a.itemKey),
      rule: 'submit-arrival-times',
      orderNum: a.orderNum,
      shipperName: a.shipperName,
      title: `Mark ${a.actName} done`,
      due: a.day,
      target: { kind: 'mark-done', itemKey: a.itemKey, day: a.day },
    })
  }
  return out
}

/**
 * One task per ORDER (not per act): two delivery acts on one order still need
 * one BOL, and an order-level key survives a dispatcher retyping a local job's
 * services. Due on the latest qualifying act's day.
 */
function documentRule(
  f: DriverTaskFacts,
  rule: DriverTaskRuleId,
  codes: ReadonlySet<string>,
  sources: ReadonlySet<TaskActSource> | null,
  documentType: string,
  title: string,
): TaskSpec[] {
  const docs = f.documentTypesByOrder
  if (docs === null) return []
  const byOrder = new Map<number, TaskAct>()
  for (const a of f.acts) {
    if (!isDriverAct(a) || !codes.has(a.actCode as string)) continue
    if (sources !== null && !sources.has(a.source)) continue
    if (doneState(a) !== true) continue
    const prev = byOrder.get(a.orderNum)
    if (!prev || a.day > prev.day) byOrder.set(a.orderNum, a)
  }
  const out: TaskSpec[] = []
  for (const [orderNum, a] of byOrder) {
    if (docs.get(orderNum)?.has(documentType)) continue
    out.push({
      key: taskKey(rule, orderNum, 'order'),
      rule,
      orderNum,
      shipperName: a.shipperName,
      title,
      due: a.day,
      target: { kind: 'upload-document', orderNum, documentType },
    })
  }
  return out
}

/** Weight tickets are a longhaul document; a local job's LOAD is not weighed. */
const LONGHAUL_SOURCES: ReadonlySet<TaskActSource> = new Set([
  'longhaul-activity',
  'order-assigned',
])

/**
 * The open driver tasks for these facts, oldest due first (then order, then
 * key, so the list is deterministic).
 */
export function evaluateDriverTasks(f: DriverTaskFacts): TaskSpec[] {
  const out: TaskSpec[] = []
  if (f.enabledRules.has('submit-arrival-times')) out.push(...submitArrivalTimes(f))
  if (f.enabledRules.has('submit-bol')) {
    out.push(
      ...documentRule(
        f,
        'submit-bol',
        BOL_ACT_CODES,
        null,
        BOL_DOCUMENT_TYPE,
        'Upload the Bill of Lading',
      ),
    )
  }
  if (f.enabledRules.has('submit-weight-ticket')) {
    out.push(
      ...documentRule(
        f,
        'submit-weight-ticket',
        WEIGHT_TICKET_ACT_CODES,
        LONGHAUL_SOURCES,
        WEIGHT_TICKET_DOCUMENT_TYPE,
        'Upload the weight ticket',
      ),
    )
  }
  return out.sort(
    (a, b) =>
      (a.due < b.due ? -1 : a.due > b.due ? 1 : 0) ||
      a.orderNum - b.orderNum ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  )
}
