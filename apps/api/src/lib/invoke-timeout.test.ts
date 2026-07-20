// ---------------------------------------------------------------------------
// Unit tests for the client-side downstream invoke timeout.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  invokeTimeoutMs,
  withInvokeTimeout,
  InvokeTimeoutError,
  DEFAULT_DOWNSTREAM_TIMEOUT_MS,
} from './invoke-timeout'

afterEach(() => {
  vi.useRealTimers()
})

describe('invokeTimeoutMs', () => {
  it('adds overhead to the default budget when no call budget is given', () => {
    // 15000 default + 4000 overhead
    expect(invokeTimeoutMs()).toBe(DEFAULT_DOWNSTREAM_TIMEOUT_MS + 4_000)
  })

  it('is relative to the call budget so it is never tighter than requested', () => {
    expect(invokeTimeoutMs(10_000)).toBe(14_000)
    expect(invokeTimeoutMs(5_000)).toBe(9_000)
  })

  it('caps below the 29s Lambda wall', () => {
    expect(invokeTimeoutMs(60_000)).toBe(27_000)
  })

  it('falls back to the default for non-positive budgets', () => {
    expect(invokeTimeoutMs(0)).toBe(DEFAULT_DOWNSTREAM_TIMEOUT_MS + 4_000)
    expect(invokeTimeoutMs(-1)).toBe(DEFAULT_DOWNSTREAM_TIMEOUT_MS + 4_000)
  })
})

describe('withInvokeTimeout', () => {
  it('returns the result when fn settles before the timeout', async () => {
    const out = await withInvokeTimeout(1_000, () => Promise.resolve('ok'))
    expect(out).toBe('ok')
  })

  it('throws InvokeTimeoutError when the timer fires before fn settles', async () => {
    vi.useFakeTimers()
    // A hung call that only rejects when its abort signal fires (mirrors the
    // AWS SDK canceling an in-flight send).
    const p = withInvokeTimeout<string>(
      5_000,
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted by signal')))
        }),
    )
    const assertion = expect(p).rejects.toBeInstanceOf(InvokeTimeoutError)
    await vi.advanceTimersByTimeAsync(5_001)
    await assertion
  })

  it('propagates a non-timeout error unchanged', async () => {
    const boom = new Error('real downstream failure')
    await expect(withInvokeTimeout(1_000, () => Promise.reject(boom))).rejects.toBe(boom)
  })
})
