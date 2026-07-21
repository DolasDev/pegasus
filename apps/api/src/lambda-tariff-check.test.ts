// Unit tests for the daily tariff coverage-check cron. The DB/repository,
// CloudWatch, and global fetch are all mocked — this exercises the coverage-days
// gauge emission (incl. the no-active-version → 0 case) and the best-effort
// artifact probe staying best-effort (a probe throw or an unexpected 200 never
// breaks the run or blocks the gauge), without any network or DB.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockCwSend, mockCoverageDays } = vi.hoisted(() => ({
  mockCwSend: vi.fn(),
  mockCoverageDays: vi.fn(),
}))

vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: class {
    send = mockCwSend
  },
  PutMetricDataCommand: class {
    constructor(
      public input: {
        Namespace: string
        MetricData: Array<{ MetricName: string; Value: number }>
      },
    ) {}
  },
}))
vi.mock('./db', () => ({ db: {} }))
vi.mock('./repositories', () => ({ getActiveTariffCoverageDays: mockCoverageDays }))

import { handler } from './lambda-tariff-check'

interface Published {
  name: string
  value: number
}

/** The (metricName, value) pairs passed to every PutMetricDataCommand this run. */
function published(): Published[] {
  return mockCwSend.mock.calls.map((c) => {
    const point = (c[0] as { input: { MetricData: Array<{ MetricName: string; Value: number }> } })
      .input.MetricData[0]!
    return { name: point.MetricName, value: point.Value }
  })
}

const fetchMock = vi.fn()

describe('lambda-tariff-check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    mockCwSend.mockResolvedValue({})
    mockCoverageDays.mockResolvedValue(298)
    // Default: probe fails (the WAF-gated normal case).
    fetchMock.mockRejectedValue(new Error('403 Forbidden'))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('publishes the coverage-days gauge for 400NG on Pegasus/Rating', async () => {
    await handler()
    expect(mockCoverageDays).toHaveBeenCalledWith(expect.anything(), '400NG')
    const coverage = published().find((p) => p.name === 'TariffCoverageDays')
    expect(coverage).toEqual({ name: 'TariffCoverageDays', value: 298 })
  })

  it('publishes 0 when no version is active (so the < 45 alarm fires on a lapse)', async () => {
    mockCoverageDays.mockResolvedValue(0)
    await handler()
    const coverage = published().find((p) => p.name === 'TariffCoverageDays')
    expect(coverage).toEqual({ name: 'TariffCoverageDays', value: 0 })
  })

  it('does NOT emit TariffArtifactDetected when the probe fails (the expected case)', async () => {
    await handler()
    expect(published().some((p) => p.name === 'TariffArtifactDetected')).toBe(false)
    // The reliable coverage gauge is still published.
    expect(published().some((p) => p.name === 'TariffCoverageDays')).toBe(true)
  })

  it('does NOT emit TariffArtifactDetected on a non-200 probe response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 } as unknown as Response)
    await handler()
    expect(published().some((p) => p.name === 'TariffArtifactDetected')).toBe(false)
  })

  it('emits TariffArtifactDetected=1 when the probe unexpectedly returns 200', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as unknown as Response)
    await handler()
    const detected = published().find((p) => p.name === 'TariffArtifactDetected')
    expect(detected).toEqual({ name: 'TariffArtifactDetected', value: 1 })
  })

  it('probes next year’s artifact URL (best-effort) after the gauge', async () => {
    await handler()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/-400ng-baseline-rates\.xlsx$/),
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('never throws even when the probe rejects (coverage gauge is the reliable duty)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    await expect(handler()).resolves.toBeUndefined()
    expect(published().some((p) => p.name === 'TariffCoverageDays')).toBe(true)
  })

  it('swallows a PutMetricData failure — observability must not fail the run', async () => {
    // Non-Error rejection also exercises the String(err) fallback in the catch.
    mockCwSend.mockRejectedValue('cloudwatch unavailable')
    await expect(handler()).resolves.toBeUndefined()
  })

  it('swallows a non-Error probe rejection (String(err) fallback)', async () => {
    fetchMock.mockRejectedValue('opaque failure')
    await expect(handler()).resolves.toBeUndefined()
    expect(published().some((p) => p.name === 'TariffCoverageDays')).toBe(true)
  })
})
