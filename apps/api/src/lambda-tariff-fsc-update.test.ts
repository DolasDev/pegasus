// Unit tests for the weekly EIA fuel-surcharge cron. Secrets Manager, CloudWatch,
// the DB/repository, and global fetch are all mocked — this exercises the
// inert-until-configured gate, the EIA parse/convert, the upsert call, and the
// success/failure metric emission without any network or DB.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockSmSend, mockCwSend, mockUpsert } = vi.hoisted(() => ({
  mockSmSend: vi.fn(),
  mockCwSend: vi.fn(),
  mockUpsert: vi.fn(),
}))

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = mockSmSend
  },
  GetSecretValueCommand: class {
    constructor(public input: unknown) {}
  },
  ResourceNotFoundException: class extends Error {},
}))
vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: class {
    send = mockCwSend
  },
  PutMetricDataCommand: class {
    constructor(public input: { Namespace: string; MetricData: Array<{ MetricName: string }> }) {}
  },
}))
vi.mock('./db', () => ({ db: {} }))
vi.mock('./repositories', () => ({ upsertTariffFuelSurcharge: mockUpsert }))

import { ResourceNotFoundException } from '@aws-sdk/client-secrets-manager'
import { handler } from './lambda-tariff-fsc-update'

function eiaResponse(value: string, period: string) {
  return {
    ok: true,
    json: async () => ({ response: { data: [{ value, period }] } }),
  } as unknown as Response
}

/** The metric names passed to every PutMetricDataCommand this run. */
function publishedMetrics(): string[] {
  return mockCwSend.mock.calls.map(
    (c) =>
      (c[0] as { input: { MetricData: Array<{ MetricName: string }> } }).input.MetricData[0]!
        .MetricName,
  )
}

const fetchMock = vi.fn()

describe('lambda-tariff-fsc-update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    process.env['EIA_API_KEY_SECRET_NAME'] = 'pegasus/test/eia-api-key'
    mockCwSend.mockResolvedValue({})
    mockUpsert.mockResolvedValue({ percentBps: 1100 })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env['EIA_API_KEY_SECRET_NAME']
  })

  it('no-ops when the secret name env var is unset (never touches EIA or the DB)', async () => {
    delete process.env['EIA_API_KEY_SECRET_NAME']
    await handler()
    expect(mockSmSend).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('no-ops when the secret does not exist yet (inert until provisioned)', async () => {
    mockSmSend.mockRejectedValue(new ResourceNotFoundException({ message: 'nope', $metadata: {} }))
    await handler()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('no-ops when the secret exists but is empty', async () => {
    mockSmSend.mockResolvedValue({ SecretString: '   ' })
    await handler()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('fetches EIA, upserts the price as cents with source EIA_AUTO, and emits success', async () => {
    mockSmSend.mockResolvedValue({ SecretString: 'my-eia-key' })
    fetchMock.mockResolvedValue(eiaResponse('4.796', '2026-07-13'))

    await handler()

    // Key is passed to EIA (URL-encoded).
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('api_key=my-eia-key'))
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tariffCode: '400NG',
        dieselPriceCentsPerGallon: 480, // 4.796 * 100, rounded
        source: 'EIA_AUTO',
        effectiveFrom: new Date('2026-07-13T00:00:00.000Z'),
      }),
    )
    expect(publishedMetrics()).toContain('FscUpdateSuccess')
    expect(publishedMetrics()).not.toContain('FscUpdateFailure')
  })

  it('emits FscUpdateFailure and rethrows when EIA returns a non-200', async () => {
    mockSmSend.mockResolvedValue({ SecretString: 'my-eia-key' })
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'API_KEY_INVALID',
    } as unknown as Response)

    await expect(handler()).rejects.toThrow(/403/)
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(publishedMetrics()).toContain('FscUpdateFailure')
  })
})
