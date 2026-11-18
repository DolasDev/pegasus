// ---------------------------------------------------------------------------
// Driver To Do — the API's row contract (`GET /api/v1/me/tasks`). The task
// shape itself is @pegasus/domain's TaskSpec; the API adds the bucket it
// computed against the driver's day. Source of truth:
// apps/api/src/handlers/me-tasks.ts.
// ---------------------------------------------------------------------------

import type { DriverTaskRuleId, TaskBucket, TaskSpec } from '@pegasus/domain'

/** Andon: the driver can't do this task, and said why. Operations was told. */
export interface TaskBlocked {
  reason: string
  /** When it was first blocked (ISO). */
  at: string
}

export type DriverTask = TaskSpec & { bucket: TaskBucket; blocked?: TaskBlocked | null }

export interface DriverTasksMeta {
  today: string
  from: string
  to: string
  /** Rules the tenant turned on. Empty ⇒ the To Do is off for this tenant. */
  enabledRules: DriverTaskRuleId[]
  /** Itinerary sources that could not be read; the list is partial when non-empty. */
  failedSources: string[]
  /** Pegasus reads that failed (`actFacts`, `documents`); also partial. */
  unavailable: string[]
  /** Tasks the driver snoozed or dismissed. */
  hidden: number
}

export interface DriverTasksResponse {
  tasks: DriverTask[]
  meta: DriverTasksMeta
}
