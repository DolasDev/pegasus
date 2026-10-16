// ---------------------------------------------------------------------------
// Wire shapes of the pegII task routes (movemanager `TaskEndpoints`, capability
// `pegii.tasks.v1`). Every field is pegII's own `TaskDto`, camelCase as sent.
//
// A task the cloud created (`createdByApi`) carries its registered type, full
// title and priority; a desktop task carries its legacy code as `taskType`, its
// (uppercased, ≤50) grid text as `title`, and `priority: null`.
// ---------------------------------------------------------------------------

export interface PegiiTaskDto {
  id: number
  orderNumber: number
  taskType: string
  title: string
  /** `Tasks.note`. */
  description: string | null
  priority: string | null
  /** `YYYY-MM-DD`. */
  dueDate: string | null
  assigneeCode: number
  completed: boolean
  /** Site-local, no offset (what the desktop stamps). Null while open. */
  completedAt: string | null
  completedBy: number | null
  actualDate: string | null
  active: boolean
  createdByApi: boolean
  closeReason: string | null
  /** UTC; only for a close made through the API. */
  closedUtc: string | null
  /** UTC; only for a task the cloud created (`Tasks` has no created column). */
  createdUtc: string | null
}

/** Body of `POST /api/v1/pegii/orders/{n}/tasks`. */
export interface PegiiCreateTaskBody {
  taskType: string
  title: string
  description?: string
  priority?: string
  dueDate: string
  assigneeCode?: number
  idempotencyKey?: string
}

export interface PegiiCreateTaskResultDto {
  task: PegiiTaskDto
  alreadyExists: boolean
}

export interface PegiiCloseTaskResultDto {
  task: PegiiTaskDto
  alreadyClosed: boolean
}

export interface PegiiOrderTasksDto {
  items: PegiiTaskDto[]
}

export interface PegiiTaskSearchPageDto {
  items: PegiiTaskDto[]
  nextCursor: number | null
}

/** `GET /api/v1/pegii/tasks` — cloud-created tasks of one type across orders. */
export interface TaskSearchCriteria {
  taskType: string
  /** true = open only, false = completed only, absent = both. */
  open?: boolean
  /** `YYYY-MM-DD`; strictly before. */
  dueBefore?: string
  cursor?: number
  limit?: number
}

/** pegII's own limit on the search page (movemanager `ApiTaskSearchCriteria.MaxLimit`). */
export const TASK_SEARCH_MAX_LIMIT = 500
