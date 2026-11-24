// ---------------------------------------------------------------------------
// The task's wire shape — one definition for every place a task leaves the
// API: the /pegii/tasks routes, and the `pegasus.task_closed` signal a waiting
// Workflow receives (lib/task-await-delivery.ts). `await_task` returns the same
// shape whether the task was already closed or closed later.
// ---------------------------------------------------------------------------

import type { TaskRecord } from '../gateways/task.gateway'

/**
 * A task in the SDK's shape. Ids are strings (opaque per store) and `store` says
 * which store answered (`legacy` = pegII, `cloud` = the platform). For a legacy
 * task, `createdAt` is known only when the cloud created it (pegII's `Tasks` has
 * no created column) and `closedAt` only for a close made through the API;
 * `completedAt` is the site-local time MoveManager stamps on any completion.
 */
export function toTaskResponse(task: TaskRecord) {
  return {
    id: task.id,
    orderId: task.orderId,
    taskType: task.taskType,
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueDate: task.dueDate,
    assigneeCode: task.assigneeCode,
    status: task.status,
    reason: task.reason,
    createdByApi: task.createdByApi,
    active: task.active,
    completedAt: task.completedAt,
    completedBy: task.completedBy,
    actualDate: task.actualDate,
    createdAt: task.createdAt,
    closedAt: task.closedAt,
    store: task.store,
    role: task.role,
    assigneeUnresolved: task.assigneeUnresolved,
  }
}

export type TaskResponse = ReturnType<typeof toTaskResponse>
