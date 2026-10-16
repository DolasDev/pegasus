// ---------------------------------------------------------------------------
// TaskGateway — the seam for pegII operational tasks (the `Tasks` table plus
// the site API's `pegasus_api_task_meta` sidecar). Tasks live only in the
// legacy pegII (MoveManager) system; there is no cloud copy. See
// task-gateway.factory.ts for how a tenant resolves to a live gateway, and
// pegii-task.gateway.ts for the implementation (NW pulse texting Phase 6).
//
// Every method requires the site to advertise `pegii.tasks.v1`. A site without
// it has no task routes, so its 404 would otherwise read as "no such task".
// ---------------------------------------------------------------------------

import type {
  PegiiCloseTaskResultDto,
  PegiiCreateTaskBody,
  PegiiCreateTaskResultDto,
  PegiiTaskDto,
  PegiiTaskSearchPageDto,
  TaskSearchCriteria,
} from './pegii/pegii-task.dto'

export type TaskCreateOutcome =
  | ({ found: true } & PegiiCreateTaskResultDto)
  /** pegII's 404, with its code (`ORDER_NOT_FOUND`). */
  | { found: false; code: string; message: string }

export interface TaskGateway {
  /** Every task on the order, desktop and cloud alike. Null when the order doesn't exist. */
  listOrderTasks(orderNumber: number): Promise<PegiiTaskDto[] | null>

  /** One task. Null when it doesn't exist. */
  getTask(taskId: number): Promise<PegiiTaskDto | null>

  /** One keyset page of cloud-created tasks of one type, across orders. */
  searchTasks(criteria: TaskSearchCriteria): Promise<PegiiTaskSearchPageDto>

  /**
   * Create a task on an order. The site validates (its 400 passes through as a
   * PegiiApiError) and owns idempotency: the same `idempotencyKey` with the same
   * request answers `alreadyExists`; with a different request, 409.
   */
  createTask(orderNumber: number, body: PegiiCreateTaskBody): Promise<TaskCreateOutcome>

  /** Close any task. Null when it doesn't exist. A repeat close answers `alreadyClosed`. */
  closeTask(taskId: number, reason: string | null): Promise<PegiiCloseTaskResultDto | null>
}
