// ---------------------------------------------------------------------------
// Unit tests for the per-request downstream-timing accumulator.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import { runWithTiming, getTiming, recordDownstream } from './request-timing'

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('request-timing', () => {
  it('has no store outside a runWithTiming scope', () => {
    expect(getTiming()).toBeUndefined()
  })

  // Fake timers, so `performance.now()` inside recordDownstream advances by
  // exactly what we advance the clock by. This assertion used to compare two
  // real wall-clock measurements — `ms.mssql > ms.db`, "two calls vs one" — which
  // is not a property setTimeout guarantees: a 10ms timer waits *at least* 10ms
  // and under CPU contention a single one can overshoot two others combined. It
  // failed exactly that way during a full-parallel `turbo run test`
  // (db 22.49ms vs mssql 21.35ms). Faking the clock makes the accumulation
  // itself assertable — 2 x 10ms is exactly 20 — instead of inferring it from an
  // inequality between races.
  it('accumulates duration and call count per downstream within a scope', async () => {
    vi.useFakeTimers()
    try {
      const pending = runWithTiming(async () => {
        await recordDownstream('db', () => tick(10))
        await recordDownstream('mssql', () => tick(10))
        await recordDownstream('mssql', () => tick(10))
        return getTiming()!
      })
      // The three ticks are sequential, so the scope needs 30ms of clock total.
      await vi.advanceTimersByTimeAsync(30)
      const timing = await pending

      expect(timing.calls).toEqual({ db: 1, mssql: 2, tunnel: 0 })
      expect(timing.ms.db).toBe(10)
      expect(timing.ms.mssql).toBe(20) // summed across both calls, not overwritten
      expect(timing.ms.tunnel).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns the wrapped call result unchanged', async () => {
    const out = await runWithTiming(() => recordDownstream('tunnel', () => Promise.resolve(42)))
    expect(out).toBe(42)
  })

  it('still records timing when the wrapped call throws', async () => {
    const timing = await runWithTiming(async () => {
      await expect(recordDownstream('db', () => Promise.reject(new Error('boom')))).rejects.toThrow(
        'boom',
      )
      return getTiming()!
    })
    expect(timing.calls.db).toBe(1)
  })

  it('is a transparent pass-through outside a scope (no store, no throw)', async () => {
    const out = await recordDownstream('db', () => Promise.resolve('ok'))
    expect(out).toBe('ok')
    expect(getTiming()).toBeUndefined()
  })

  it('isolates timing between concurrent scopes', async () => {
    const [a, b] = await Promise.all([
      runWithTiming(async () => {
        await recordDownstream('db', () => tick(5))
        return getTiming()!.calls.db
      }),
      runWithTiming(async () => {
        await recordDownstream('mssql', () => tick(5))
        return getTiming()!.calls.mssql
      }),
    ])
    expect(a).toBe(1)
    expect(b).toBe(1)
  })
})
