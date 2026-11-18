// ---------------------------------------------------------------------------
// useWorkflowQuery — runs a declared @workflow.query on demand and waits out a
// cold tenant runner (503 WORKFLOW_WORKER_STARTING + Retry-After) for up to
// 90 s. It never runs on its own: only `run()` sends a query.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ApiError } from '@/api/client'

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))
vi.mock('@/api/workflow-executions', () => ({ queryWorkflowInstance: mockQuery }))

import { QUERY_WAIT_BUDGET_MS, useWorkflowQuery } from './use-workflow-query'

const starting = (retryAfter?: number) =>
  new ApiError('starting', 'WORKFLOW_WORKER_STARTING', 503, retryAfter)

beforeEach(() => {
  vi.useFakeTimers()
  mockQuery.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useWorkflowQuery', () => {
  it('starts idle and sends nothing until run()', async () => {
    const { result } = renderHook(() => useWorkflowQuery('exec-1'))
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000))
    expect(result.current.state.status).toBe('idle')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('returns the answer', async () => {
    mockQuery.mockResolvedValue({ stage: 'packing' })
    const { result } = renderHook(() => useWorkflowQuery('exec-1'))
    await act(async () => {
      result.current.run('status')
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mockQuery).toHaveBeenCalledWith('exec-1', 'status', [], expect.any(AbortSignal))
    expect(result.current.state).toMatchObject({ status: 'success', result: { stage: 'packing' } })
  })

  it('shows "waking" on 503 WORKFLOW_WORKER_STARTING and retries after Retry-After', async () => {
    mockQuery.mockRejectedValueOnce(starting(5)).mockResolvedValueOnce({ stage: 'done' })
    const { result } = renderHook(() => useWorkflowQuery('exec-1'))
    await act(async () => {
      result.current.run('status')
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toMatchObject({ status: 'running', waking: true })
    await act(() => vi.advanceTimersByTimeAsync(4_999))
    expect(mockQuery).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(result.current.state).toMatchObject({ status: 'success', result: { stage: 'done' } })
  })

  it('falls back to 15 s when Retry-After is unreadable', async () => {
    mockQuery.mockRejectedValueOnce(starting()).mockResolvedValueOnce('ok')
    const { result } = renderHook(() => useWorkflowQuery('exec-1'))
    await act(async () => {
      result.current.run('status')
      await vi.advanceTimersByTimeAsync(14_999)
    })
    expect(mockQuery).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  it('gives up after the 90 s budget with a "try again" error', async () => {
    mockQuery.mockRejectedValue(starting(15))
    const { result } = renderHook(() => useWorkflowQuery('exec-1'))
    await act(async () => {
      result.current.run('status')
      await vi.advanceTimersByTimeAsync(QUERY_WAIT_BUDGET_MS + 30_000)
    })
    expect(result.current.state).toMatchObject({ status: 'error', gaveUp: true })
    // 0, 15, 30, 45, 60, 75, 90 s — and nothing after the budget is spent.
    expect(mockQuery.mock.calls.length).toBeLessThanOrEqual(7)
    const calls = mockQuery.mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000))
    expect(mockQuery).toHaveBeenCalledTimes(calls)
  })

  it('does not retry other errors', async () => {
    mockQuery.mockRejectedValue(new ApiError('nope', 'QUERY_FAILED', 422))
    const { result } = renderHook(() => useWorkflowQuery('exec-1'))
    await act(async () => {
      result.current.run('status')
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(result.current.state).toMatchObject({ status: 'error', gaveUp: false })
    expect((result.current.state as unknown as { error: ApiError }).error.code).toBe('QUERY_FAILED')
  })

  it('stops retrying on unmount', async () => {
    mockQuery.mockRejectedValue(starting(5))
    const { result, unmount } = renderHook(() => useWorkflowQuery('exec-1'))
    await act(async () => {
      result.current.run('status')
      await vi.advanceTimersByTimeAsync(0)
    })
    unmount()
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })
})
