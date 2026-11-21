// ---------------------------------------------------------------------------
// TaskGateway — the store-neutral seam for operational tasks.
//
// Two stores implement it (task queue plan Phase 3, TQ-D4):
//   - `legacy`: pegII's `Tasks` table plus the site API's
//     `pegasus_api_task_meta` sidecar (pegii-task.gateway.ts, NW pulse
//     Phase 6). Ids are pegII ints, carried as strings.
//   - `cloud`: the platform's own task rows (Phase 3a). Ids are UUIDs.
//
// Callers see one record shape whichever store answered, and every record
// says which store it came from (`store`), so a Workflow never has to care.
// See task-gateway.factory.ts for how a tenant resolves to a gateway.
// ---------------------------------------------------------------------------

export type TaskStore = 'legacy' | 'cloud'

/** One task, in the SDK's shape. Absent facts are null, never invented. */
export interface TaskRecord {
  store: TaskStore
  /** Opaque string: a pegII int for `legacy`, a UUID for `cloud`. */
  id: string
  /** The pegII order number, digits. */
  orderId: string
  taskType: string
  title: string
  description: string | null
  priority: string | null
  /** `YYYY-MM-DD`. */
  dueDate: string | null
  /** A MoveManager employee code. Legacy only; null on cloud. */
  assigneeCode: number | null
  status: 'open' | 'closed'
  /** The close reason, when one was given. */
  reason: string | null
  /** True when the platform (not the desktop) created it. */
  createdByApi: boolean
  active: boolean
  /** Legacy: site-local, no offset (what the desktop stamps). Null while open. */
  completedAt: string | null
  completedBy: number | null
  actualDate: string | null
  /** UTC. Legacy knows it only for a task the cloud created. */
  createdAt: string | null
  /** UTC. Legacy knows it only for a close made through the API. */
  closedAt: string | null
  /** The owning role (`operations` or a Cedar role-group name). Cloud only; null on legacy. */
  role: string | null
  /**
   * Why an owner that resolves per move found nobody (`NO_DISPATCHER` |
   * `DISPATCHER_NOT_LINKED`). Cloud only; null when assigned, and on legacy.
   */
  assigneeUnresolved: TaskAssigneeUnresolved | null
}

export type TaskAssigneeUnresolved = 'NO_DISPATCHER' | 'DISPATCHER_NOT_LINKED'

/** Who a cloud task is assigned to, as resolved by the caller (D4: `operations` → the move's dispatcher). */
export interface TaskAssignee {
  userId: string | null
  /** The legacy employee (salesman.code) it was resolved from. */
  employeeCode: number | null
  unresolved: TaskAssigneeUnresolved | null
}

export interface TaskCreateInput {
  taskType: string
  title: string
  description?: string
  priority?: string
  /** `YYYY-MM-DD`. Required on legacy (`DUE_DATE_REQUIRED`); optional on cloud. */
  dueDate?: string
  /** Legacy only: a MoveManager employee code (cloud → `UNSUPPORTED_ON_CLOUD_STORE`). */
  assigneeCode?: number
  /** Cloud only, required there: the owning role. Legacy ignores it (routing already used it). */
  role?: string
  /** Cloud only: the resolved assignee. Absent = unassigned. */
  assignee?: TaskAssignee
  /** The same key with the same request answers `alreadyExists`; with a different one, 409. */
  idempotencyKey?: string
}

/**
 * A store's own refusal, with the HTTP status and code the router answers
 * (the legacy store's equivalent is PegiiApiError, passed through from the site).
 */
export class TaskStoreError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message)
    this.name = 'TaskStoreError'
  }
}

export type TaskCreateOutcome =
  | { found: true; task: TaskRecord; alreadyExists: boolean }
  /** The order doesn't exist, with the store's code (`ORDER_NOT_FOUND`). */
  | { found: false; code: string; message: string }

export interface TaskCloseResult {
  task: TaskRecord
  alreadyClosed: boolean
}

/** Tasks of one type across orders. */
export interface TaskSearchCriteria {
  taskType: string
  /** true = open only, false = closed only, absent = both. */
  open?: boolean
  /** `YYYY-MM-DD`; strictly before. */
  dueBefore?: string
  /** Opaque, from a previous page's `nextCursor`. */
  cursor?: string
  limit?: number
}

export interface TaskSearchPage {
  items: TaskRecord[]
  nextCursor: string | null
}

export interface TaskGateway {
  readonly store: TaskStore

  /** Every task on the order in this store. Null when the order doesn't exist. */
  listOrderTasks(orderNumber: string): Promise<TaskRecord[] | null>

  /** One task. Null when it doesn't exist (including an id this store can't hold). */
  getTask(taskId: string): Promise<TaskRecord | null>

  /** One keyset page of tasks of one type, across orders. */
  searchTasks(criteria: TaskSearchCriteria): Promise<TaskSearchPage>

  /** Create a task on an order. The store validates and owns idempotency. */
  createTask(orderNumber: string, input: TaskCreateInput): Promise<TaskCreateOutcome>

  /** Close any task. Null when it doesn't exist. A repeat close answers `alreadyClosed`. */
  closeTask(taskId: string, reason: string | null): Promise<TaskCloseResult | null>
}
