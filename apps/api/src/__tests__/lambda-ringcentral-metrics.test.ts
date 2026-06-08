// Unit tests for the RingCentral health-metrics emitter cron.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  outboxCount: vi.fn(),
  subCount: vi.fn(),
  connCount: vi.fn(),
  cursorAggregate: vi.fn(),
  send: vi.fn(),
}))

vi.mock('../db', () => ({
  db: {
    messageForwardOutbox: { count: h.outboxCount },
    ringCentralSubscription: { count: h.subCount },
    ringCentralConnection: { count: h.connCount },
    ringCentralSyncCursor: { aggregate: h.cursorAggregate },
  },
}))
vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: class {
    send = h.send
  },
  PutMetricDataCommand: class {
    constructor(public readonly input: unknown) {}
  },
}))

import { handler } from '../lambda-ringcentral-metrics'

function metricMap(): Record<string, { Value: number; Unit: string }> {
  const cmd = h.send.mock.calls[0]![0] as {
    input: { MetricData: Array<{ MetricName: string; Value: number; Unit: string }> }
  }
  return Object.fromEntries(
    cmd.input.MetricData.map((m) => [m.MetricName, { Value: m.Value, Unit: m.Unit }]),
  )
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.send.mockResolvedValue({})
})

describe('lambda-ringcentral-metrics', () => {
  it('emits all five health gauges with the right values and units', async () => {
    // outbox count is called twice (pending, dead) — order matters.
    h.outboxCount.mockResolvedValueOnce(7).mockResolvedValueOnce(2)
    h.subCount.mockResolvedValue(1)
    h.connCount.mockResolvedValue(3)
    const tenMinAgo = new Date(Date.now() - 10 * 60_000)
    h.cursorAggregate.mockResolvedValue({ _min: { lastSyncAt: tenMinAgo } })

    await handler()

    const m = metricMap()
    expect(m['OutboxPending']).toEqual({ Value: 7, Unit: 'Count' })
    expect(m['OutboxDead']).toEqual({ Value: 2, Unit: 'Count' })
    expect(m['SubscriptionsDead']).toEqual({ Value: 1, Unit: 'Count' })
    expect(m['ConnectionsUnhealthy']).toEqual({ Value: 3, Unit: 'Count' })
    expect(m['SyncLagSeconds']!.Unit).toBe('Seconds')
    // ~600s; allow slack for test execution time.
    expect(m['SyncLagSeconds']!.Value).toBeGreaterThan(595)
    expect(m['SyncLagSeconds']!.Value).toBeLessThan(615)
  })

  it('reports zero sync lag when no connection has synced yet (inert)', async () => {
    h.outboxCount.mockResolvedValue(0)
    h.subCount.mockResolvedValue(0)
    h.connCount.mockResolvedValue(0)
    h.cursorAggregate.mockResolvedValue({ _min: { lastSyncAt: null } })

    await handler()

    expect(metricMap()['SyncLagSeconds']).toEqual({ Value: 0, Unit: 'Seconds' })
  })
})
