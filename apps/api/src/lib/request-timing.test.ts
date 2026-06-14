// ---------------------------------------------------------------------------
// Unit tests for the per-request downstream-timing accumulator.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { runWithTiming, getTiming, recordDownstream } from './request-timing'

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('request-timing', () => {
  it('has no store outside a runWithTiming scope', () => {
    expect(getTiming()).toBeUndefined()
  })

  it('accumulates duration and call count per downstream within a scope', async () => {
    const timing = await runWithTiming(async () => {
      await recordDownstream('db', () => tick(10))
      await recordDownstream('mssql', () => tick(10))
      await recordDownstream('mssql', () => tick(10))
      return getTiming()!
    })

    expect(timing.calls).toEqual({ db: 1, mssql: 2, tunnel: 0 })
    // Timing is wall-clock; assert it registered something rather than an exact ms.
    expect(timing.ms.db).toBeGreaterThan(0)
    expect(timing.ms.mssql).toBeGreaterThan(timing.ms.db) // two calls vs one
    expect(timing.ms.tunnel).toBe(0)
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
