// ---------------------------------------------------------------------------
// Driver To Do — the API's row contract (`GET /api/v1/me/tasks`). The task
// shape itself is @pegasus/domain's TaskSpec; the API adds the bucket it
// computed against the driver's day. Source of truth:
// apps/api/src/handlers/me-tasks.ts.
// ---------------------------------------------------------------------------

import type { DriverTaskRuleId, TaskBucket, TaskSpec } from '@pegasus/domain'

export type DriverTask = TaskSpec & { bucket: TaskBucket }

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
