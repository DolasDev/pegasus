// ---------------------------------------------------------------------------
// Unit tests for the AVP policy-store count metric emitter.
//
// Pins:
//   - the Prisma query (`tenants WHERE policy_store_id IS NOT NULL`) so a
//     column rename in a future migration can't silently zero out the count
//   - the CloudWatch namespace + metric name, which are duplicated literally
//     between this Lambda and packages/infra/lib/metrics.ts (the alarms +
//     dashboard widget reference the same strings); a drift here would
//     publish to a namespace nothing alarms on
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSend, putMetricDataInputs, mockTenantCount } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  putMetricDataInputs: [] as unknown[],
  mockTenantCount: vi.fn(),
}))

vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: class {
    send = mockSend
  },
  PutMetricDataCommand: class {
    public input: unknown
    constructor(input: unknown) {
      this.input = input
      putMetricDataInputs.push(input)
    }
  },
}))

vi.mock('../db', () => ({
  db: {
    tenant: { count: mockTenantCount },
  },
}))

import { handler } from '../lambda-avp-store-count'

beforeEach(() => {
  mockSend.mockReset().mockResolvedValue({})
  putMetricDataInputs.length = 0
  mockTenantCount.mockReset()
})

describe('lambda-avp-store-count', () => {
  it('counts tenants with a non-null policy_store_id', async () => {
    mockTenantCount.mockResolvedValue(7)

    await handler()

    expect(mockTenantCount).toHaveBeenCalledWith({ where: { policyStoreId: { not: null } } })
  })

  it('publishes to Pegasus/Authorization/PolicyStoreCount with Unit=Count', async () => {
    mockTenantCount.mockResolvedValue(42)

    await handler()

    expect(putMetricDataInputs).toHaveLength(1)
    const input = putMetricDataInputs[0] as {
      Namespace: string
      MetricData: Array<{ MetricName: string; Value: number; Unit: string }>
    }
    expect(input.Namespace).toBe('Pegasus/Authorization')
    expect(input.MetricData).toHaveLength(1)
    expect(input.MetricData[0]).toMatchObject({
      MetricName: 'PolicyStoreCount',
      Value: 42,
      Unit: 'Count',
    })
  })

  it('emits zero when no tenants have a policy store yet (cold-start safety)', async () => {
    mockTenantCount.mockResolvedValue(0)

    await handler()

    const input = putMetricDataInputs[0] as { MetricData: Array<{ Value: number }> }
    expect(input.MetricData[0]!.Value).toBe(0)
    expect(mockSend).toHaveBeenCalledTimes(1)
  })
})
