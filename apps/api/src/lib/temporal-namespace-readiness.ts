// ---------------------------------------------------------------------------
// Is a freshly minted Temporal Cloud API key usable yet on its namespace?
//
// A new key's permissions reach Temporal's backends per API, not all at once:
// in the 2026-10-12 guardrail probe (plans/in-progress/tenant-temporal-
// namespaces.md, Stage B Step 2, run 1) a key's DescribeNamespace was already
// authorized while DescribeWorkflowExecution and PollWorkflowTaskQueue were
// still PERMISSION_DENIED. Checking DescribeNamespace alone would mark the
// namespace READY before a runner could poll it. So "ready" means every API a
// runner and the API need accepts the key:
//
//   * DescribeNamespace          succeeds
//   * DescribeWorkflowExecution  of a random id: NOT_FOUND (or success)
//   * PollWorkflowTaskQueue      on a dedicated probe queue: returns, or hits
//                                its short deadline (nothing to poll, but the
//                                call got past authorization)
//
// PERMISSION_DENIED / UNAUTHENTICATED anywhere → not yet (false). Any other
// error is thrown, so the provisioner retries instead of calling it ready.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { isGrpcDeadlineError, isGrpcServiceError, type Connection } from '@temporalio/client'

/** Never used by real work: polling it can't steal a task. */
export const READINESS_TASK_QUEUE = 'pegasus-provisioner-readiness-probe'
const POLL_DEADLINE_MS = 5_000

// grpc status codes (grpc-js `status`), named here rather than importing
// @grpc/grpc-js, which apps/api doesn't declare.
const NOT_FOUND = 5
const PERMISSION_DENIED = 7
const UNAUTHENTICATED = 16

type Svc = Connection['workflowService']
type Call<K extends keyof Svc> = Svc[K] extends (req: infer R) => unknown
  ? (req: R) => Promise<unknown>
  : never

/** The slice of a Connection this check uses (a real Connection satisfies it). */
export type ReadinessConnection = {
  workflowService: {
    describeNamespace: Call<'describeNamespace'>
    describeWorkflowExecution: Call<'describeWorkflowExecution'>
    pollWorkflowTaskQueue: Call<'pollWorkflowTaskQueue'>
  }
  withDeadline: <R>(deadline: number | Date, fn: () => Promise<R>) => Promise<R>
}

function refused(err: unknown): boolean {
  return isGrpcServiceError(err) && (err.code === PERMISSION_DENIED || err.code === UNAUTHENTICATED)
}

export async function namespaceKeyAuthorized(
  connection: ReadinessConnection,
  namespace: string,
): Promise<boolean> {
  const svc = connection.workflowService

  try {
    await svc.describeNamespace({ namespace })
  } catch (err) {
    if (refused(err)) return false
    throw err
  }

  try {
    await svc.describeWorkflowExecution({
      namespace,
      execution: { workflowId: `pegasus-readiness-${randomUUID()}` },
    })
  } catch (err) {
    if (refused(err)) return false
    if (!(isGrpcServiceError(err) && err.code === NOT_FOUND)) throw err
  }

  try {
    await connection.withDeadline(Date.now() + POLL_DEADLINE_MS, () =>
      svc.pollWorkflowTaskQueue({
        namespace,
        taskQueue: { name: READINESS_TASK_QUEUE },
        identity: 'pegasus-provisioner-readiness',
      }),
    )
  } catch (err) {
    if (refused(err)) return false
    if (!isGrpcDeadlineError(err)) throw err
  }

  return true
}
