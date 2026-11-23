// ---------------------------------------------------------------------------
// Task routing — which store a task lives in (task queue plan TQ-D4, Phase 3a
// D1/D3; Steve 2026-11-19/20).
//
//   - No role        → legacy (MoveManager). Today's contract: Pulse and every
//                      existing caller are untouched.
//   - A routed role  → the store its entry in
//                      `appSettings.operations.taskRouting` names.
//   - Any other role → legacy too. The cloud store is opt-in per (tenant, role):
//                      a role moves to the cloud when its entry says `cloud`
//                      (the switchover), and back by removing it.
//
// Reads and closes by id never consult routing: the id's shape names its store
// (guardrail 3).
// ---------------------------------------------------------------------------

import { ROLE_OPTIONS } from '../authz/role-options'
import { isPegiiInt } from '../gateways/pegii-task.gateway'
import type { TaskStore } from '../gateways/task.gateway'

/** The owner that resolves per move to its dispatcher (`sales.operations_id`). */
export const OPERATIONS_TASK_ROLE = 'operations'

/** Every role a task can be owned by: `operations` + the Cedar role groups. */
export const TASK_ROLES: readonly string[] = [
  OPERATIONS_TASK_ROLE,
  ...ROLE_OPTIONS.map((r) => r.name),
]

export const isTaskRole = (role: string): boolean => TASK_ROLES.includes(role)

export type TaskRouting = Readonly<Record<string, TaskStore>>

/** The store a create (or a role-scoped search) goes to. */
export function resolveTaskStore(
  routing: TaskRouting | null | undefined,
  role: string | undefined,
): TaskStore {
  if (role === undefined) return 'legacy'
  return routing?.[role] ?? 'legacy'
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The store an id belongs to by its shape; null when it can't be any task's id. */
export function taskStoreForId(id: string): TaskStore | null {
  if (UUID_RE.test(id)) return 'cloud'
  if (isPegiiInt(id)) return 'legacy'
  return null
}

/** How each owner's assignee is chosen, per store — served by GET /tasks/routing. */
export const TASK_ASSIGNMENT_RULES = {
  legacy: {
    [OPERATIONS_TASK_ROLE]: "the move's dispatcher (sales.operations_id), sent as assigneeCode",
    default: "assigneeCode if given, else the order's coordinator",
  },
  cloud: {
    [OPERATIONS_TASK_ROLE]:
      "the move's dispatcher (sales.operations_id) via their linked cloud user; unassigned with assigneeUnresolved when there is none",
    default: 'unassigned; the role owns it',
  },
} as const
