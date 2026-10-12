// ---------------------------------------------------------------------------
// namespaceKeyAuthorized — a new key is "ready" only once every API a runner
// needs accepts it. Fake workflow service; no live Temporal.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import {
  namespaceKeyAuthorized,
  READINESS_TASK_QUEUE,
  type ReadinessConnection,
} from '../temporal-namespace-readiness'

const NS = 'pg-staging-a90b22bc4393.chgel'

/** A grpc-js style service error, as @temporalio/client surfaces it. */
function grpcError(code: number, details = ''): Error {
  return Object.assign(new Error(`${code} ${details}`), { code, details, metadata: {} })
}
const PERMISSION_DENIED = 7
const NOT_FOUND = 5
const DEADLINE_EXCEEDED = 4
const UNAVAILABLE = 14
const UNAUTHENTICATED = 16

function connection(overrides: Partial<ReadinessConnection['workflowService']> = {}) {
  const workflowService = {
    describeNamespace: vi.fn(async () => ({})),
    describeWorkflowExecution: vi.fn(async () => {
      throw grpcError(NOT_FOUND, 'workflow not found')
    }),
    pollWorkflowTaskQueue: vi.fn(async () => ({})),
    ...overrides,
  }
  const conn: ReadinessConnection = {
    workflowService,
    withDeadline: vi.fn((_deadline: number | Date, fn: () => Promise<unknown>) => fn()) as never,
  }
  return { conn, workflowService }
}

describe('namespaceKeyAuthorized', () => {
  it('is true when describe, describe-execution (NOT_FOUND) and poll are all authorized', async () => {
    const { conn, workflowService } = connection()
    expect(await namespaceKeyAuthorized(conn, NS)).toBe(true)
    expect(workflowService.describeNamespace).toHaveBeenCalledWith({ namespace: NS })
    expect(workflowService.pollWorkflowTaskQueue).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: NS, taskQueue: { name: READINESS_TASK_QUEUE } }),
    )
    // The poll is bounded so an authorized long-poll can't hang the provisioner.
    expect(conn.withDeadline).toHaveBeenCalled()
  })

  it('treats a poll that times out as authorized (nothing to poll, but the call got in)', async () => {
    const { conn } = connection({
      pollWorkflowTaskQueue: vi.fn(async () => {
        throw grpcError(DEADLINE_EXCEEDED, 'deadline exceeded')
      }),
    })
    expect(await namespaceKeyAuthorized(conn, NS)).toBe(true)
  })

  it('treats a successful describe-execution as authorized too', async () => {
    const { conn } = connection({ describeWorkflowExecution: vi.fn(async () => ({})) })
    expect(await namespaceKeyAuthorized(conn, NS)).toBe(true)
  })

  // 2026-10-12 guardrail probe, run 1: DescribeNamespace already worked while
  // DescribeWorkflowExecution and PollWorkflowTaskQueue were still refused.
  it.each([
    ['describe-namespace', 'describeNamespace', PERMISSION_DENIED],
    ['describe-execution', 'describeWorkflowExecution', PERMISSION_DENIED],
    ['poll', 'pollWorkflowTaskQueue', PERMISSION_DENIED],
    ['poll (unauthenticated)', 'pollWorkflowTaskQueue', UNAUTHENTICATED],
  ] as const)('is false while %s is still refused', async (_label, method, code) => {
    const { conn } = connection({
      [method]: vi.fn(async () => {
        throw grpcError(code, 'denied')
      }),
    })
    expect(await namespaceKeyAuthorized(conn, NS)).toBe(false)
  })

  it('throws on any other error, so the caller retries rather than calling it ready', async () => {
    const { conn } = connection({
      pollWorkflowTaskQueue: vi.fn(async () => {
        throw grpcError(UNAVAILABLE, 'connection reset')
      }),
    })
    await expect(namespaceKeyAuthorized(conn, NS)).rejects.toThrow()
  })

  it('stops at the first refusal', async () => {
    const { conn, workflowService } = connection({
      describeNamespace: vi.fn(async () => {
        throw grpcError(PERMISSION_DENIED)
      }),
    })
    expect(await namespaceKeyAuthorized(conn, NS)).toBe(false)
    expect(workflowService.describeWorkflowExecution).not.toHaveBeenCalled()
    expect(workflowService.pollWorkflowTaskQueue).not.toHaveBeenCalled()
  })
})
