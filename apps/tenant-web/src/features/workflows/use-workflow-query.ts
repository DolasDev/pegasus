import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/api/client'
import { queryWorkflowInstance } from '@/api/workflow-executions'

// ---------------------------------------------------------------------------
// useWorkflowQuery — run a declared @workflow.query on an open durable
// Workflow, on demand only.
//
// Each query wakes the tenant's runner (it idle-exits), so this is NOT a
// TanStack `useQuery`: focus refetches, intervals and invalidations must never
// send one. Only `run()` does.
//
// A cold runner takes 30–60 s. Until a worker answers, the API replies 503
// WORKFLOW_WORKER_STARTING with Retry-After; this waits that long (clamped,
// 15 s if the header is unreadable) and tries again, for up to 90 s from the
// first attempt, as the SDK's query_execution does. Any other error is final.
// ---------------------------------------------------------------------------

export const QUERY_WAIT_BUDGET_MS = 90_000
const DEFAULT_RETRY_AFTER_S = 15
const MIN_RETRY_AFTER_S = 1
const MAX_RETRY_AFTER_S = 30

export type WorkflowQueryState =
  | { status: 'idle' }
  | { status: 'running'; name: string; waking: boolean }
  | { status: 'success'; name: string; result: unknown; at: Date }
  | { status: 'error'; name: string; error: Error; gaveUp: boolean }

function isWorkerStarting(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code === 'WORKFLOW_WORKER_STARTING'
}

function retryDelayMs(err: ApiError): number {
  const s = err.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_S
  return Math.min(MAX_RETRY_AFTER_S, Math.max(MIN_RETRY_AFTER_S, s)) * 1000
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

export function useWorkflowQuery(executionId: string) {
  const [state, setState] = useState<WorkflowQueryState>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)

  // A new execution id, or unmount, abandons any query in flight.
  useEffect(() => {
    return () => {
      controller.current?.abort()
      controller.current = null
    }
  }, [executionId])

  const run = useCallback(
    (name: string, args: unknown[] = []) => {
      controller.current?.abort()
      const ac = new AbortController()
      controller.current = ac
      const started = Date.now()
      setState({ status: 'running', name, waking: false })

      void (async () => {
        for (;;) {
          try {
            const result = await queryWorkflowInstance(executionId, name, args, ac.signal)
            if (!ac.signal.aborted) setState({ status: 'success', name, result, at: new Date() })
            return
          } catch (err) {
            if (ac.signal.aborted) return
            if (isWorkerStarting(err)) {
              const delay = retryDelayMs(err)
              if (Date.now() - started + delay <= QUERY_WAIT_BUDGET_MS) {
                setState({ status: 'running', name, waking: true })
                try {
                  await sleep(delay, ac.signal)
                } catch {
                  return
                }
                continue
              }
              setState({ status: 'error', name, error: err, gaveUp: true })
              return
            }
            setState({
              status: 'error',
              name,
              error: err instanceof Error ? err : new Error(String(err)),
              gaveUp: false,
            })
            return
          }
        }
      })()
    },
    [executionId],
  )

  return { state, run }
}
