import { describe, it, expect, vi, beforeEach } from 'vitest'

const notifyErrorMock = vi.hoisted(() => vi.fn())
vi.mock('../../components/Snackbar/notify', () => ({
  notifyError: notifyErrorMock,
}))

import { fetchAndReshape } from './fetch-and-reshape'

describe('fetchAndReshape', () => {
  beforeEach(() => {
    notifyErrorMock.mockClear()
  })

  it('returns reshape(rawResponse) on the happy path', async () => {
    const fetch = vi.fn(async (_op: string, ..._args: unknown[]) => ({ rows: [1, 2, 3] }))
    const reshape = vi.fn((raw: unknown) => (raw as { rows: number[] }).rows.map((n) => n * 10))

    const result = await fetchAndReshape(fetch, 'fetchShipments', [{ x: 1 }], reshape, [])

    expect(result).toEqual([10, 20, 30])
    expect(fetch).toHaveBeenCalledWith('fetchShipments', { x: 1 })
    expect(reshape).toHaveBeenCalledTimes(1)
    expect(reshape).toHaveBeenCalledWith({ rows: [1, 2, 3] })
    expect(notifyErrorMock).not.toHaveBeenCalled()
  })

  it('forwards multiple args to the fetch primitive', async () => {
    const fetch = vi.fn(async () => [])
    await fetchAndReshape(fetch, 'op', [1, 'two', { three: true }], (r) => r as unknown[], [])
    expect(fetch).toHaveBeenCalledWith('op', 1, 'two', { three: true })
  })

  it('notifies the error and returns fallback on a thrown error', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('network down')
    })
    const reshape = vi.fn()

    const result = await fetchAndReshape(fetch, 'fetchShipments', [{}], reshape, ['fallback-item'])

    expect(result).toEqual(['fallback-item'])
    expect(reshape).not.toHaveBeenCalled()
    expect(notifyErrorMock).toHaveBeenCalledTimes(1)
    expect(notifyErrorMock).toHaveBeenCalledWith('network down')
  })

  it('falls back to String(e) when the thrown error has no message', async () => {
    const fetch = vi.fn(async () => {
      throw 'just-a-string'
    })
    const result = await fetchAndReshape(fetch, 'op', [], (r) => r, 'fb')
    expect(result).toBe('fb')
    expect(notifyErrorMock).toHaveBeenCalledWith('just-a-string')
  })

  it('does not call reshape on error', async () => {
    const reshape = vi.fn(() => 'reshaped')
    const fetch = vi.fn(async () => {
      throw new Error('boom')
    })
    await fetchAndReshape(fetch, 'op', [], reshape, 'fb')
    expect(reshape).not.toHaveBeenCalled()
  })

  it('returns the fallback type literally — does not coerce', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('boom')
    })
    const fallback = { rows: [], stale: true }
    const result = await fetchAndReshape(fetch, 'op', [], (r) => r as typeof fallback, fallback)
    expect(result).toBe(fallback)
  })
})
