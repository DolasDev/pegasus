import { describe, it, expect, vi, beforeEach } from 'vitest'

const { send, cwSend, runTemporalProvisioner, createTemporalCloudOpsClient, command } = vi.hoisted(
  () => ({
    send: vi.fn(),
    cwSend: vi.fn(async (..._args: unknown[]) => ({})),
    runTemporalProvisioner: vi.fn(async (..._args: unknown[]) => ({ outcome: 'done' })),
    createTemporalCloudOpsClient: vi.fn((opts: { apiKey: string }) => ({
      apiKey: opts.apiKey,
      listOwnApiKeys: vi.fn(async () => [{ id: 'k-new', ownerId: 'sa', expiresAt: null }]),
    })),
    /** An AWS SDK command constructor that records its name and input. */
    command: (name: string) =>
      vi.fn(function (input: unknown) {
        return { name, input }
      }),
  }),
)
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: vi.fn(function () {
    return { send }
  }),
  GetSecretValueCommand: command('GetSecretValue'),
  PutSecretValueCommand: command('PutSecretValue'),
  DescribeSecretCommand: command('DescribeSecret'),
}))
vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: vi.fn(function () {
    return { send: cwSend }
  }),
  PutMetricDataCommand: command('PutMetricData'),
}))

vi.mock('./lib/temporal-provisioner', () => ({ runTemporalProvisioner }))
vi.mock('./lib/temporal-cloud-ops', () => ({ createTemporalCloudOpsClient }))
vi.mock('./db', () => ({ db: {} }))

import { handler } from './lambda-temporal-provisioner'
import type { ProvisionerDeps } from './lib/temporal-provisioner'

const SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:1:secret:x'
const PLATFORM_ARN = 'arn:aws:secretsmanager:us-east-1:1:secret:platform'

/** Runs the handler and returns the deps it wired. */
async function wiredDeps(secret: Record<string, unknown>): Promise<ProvisionerDeps> {
  send.mockResolvedValueOnce({ SecretString: JSON.stringify(secret) })
  await handler({ action: 'daily-maintenance' })
  return runTemporalProvisioner.mock.calls[0]![1] as ProvisionerDeps
}

describe('lambda-temporal-provisioner handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['TEMPORAL_PROVISIONER_SECRET_ARN'] = SECRET_ARN
    process.env['TEMPORAL_PLATFORM_SECRET_ARN'] = PLATFORM_ARN
    process.env['ENV_NAME'] = 'staging'
  })

  it.each([
    ['null', null],
    ['an unknown action', { action: 'explode', tenantId: 't' }],
    ['a provision with no tenant', { action: 'provision' }],
    ['a rotate-own-key with a non-boolean force', { action: 'rotate-own-key', force: 'yes' }],
  ])('rejects %s without reading the secret', async (_label, event) => {
    await expect(handler(event)).rejects.toThrow(/invalid provisioner event/)
    expect(send).not.toHaveBeenCalled()
    expect(runTemporalProvisioner).not.toHaveBeenCalled()
  })

  it('reads the key from the configured secret and runs the action for its env', async () => {
    send.mockResolvedValue({ SecretString: JSON.stringify({ apiKey: 'k' }) })
    const out = await handler({ action: 'provision', tenantId: 't-1' })
    expect(out).toEqual({ outcome: 'done' })
    expect(send.mock.calls[0]![0].input).toEqual({
      SecretId: 'arn:aws:secretsmanager:us-east-1:1:secret:x',
    })
    expect(runTemporalProvisioner).toHaveBeenCalledWith(
      { action: 'provision', tenantId: 't-1' },
      expect.objectContaining({ env: 'staging' }),
    )
  })

  it.each([
    [{ action: 'retire-previous-keys' }],
    [{ action: 'daily-maintenance' }],
    [{ action: 'rotate-own-key' }],
    [{ action: 'rotate-own-key', force: true }],
  ])('accepts %j', async (event) => {
    send.mockResolvedValue({ SecretString: JSON.stringify({ apiKey: 'k' }) })
    await handler(event)
    expect(runTemporalProvisioner).toHaveBeenCalledWith(event, expect.anything())
  })

  describe('own key', () => {
    it('reports the key id the secret recorded, or null before the first rotation', async () => {
      expect(await (await wiredDeps({ apiKey: 'k', keyId: 'k-1' })).ownKey.recordedKeyId()).toBe(
        'k-1',
      )
      runTemporalProvisioner.mockClear()
      expect(await (await wiredDeps({ apiKey: 'k' })).ownKey.recordedKeyId()).toBeNull()
    })

    it('verifies the new token with a client built on that token', async () => {
      const d = await wiredDeps({ apiKey: 'old' })
      expect(await d.ownKey.verify('new-token', 'k-new')).toBe(true)
      expect(await d.ownKey.verify('new-token', 'k-other')).toBe(false)
      expect(createTemporalCloudOpsClient).toHaveBeenLastCalledWith(
        expect.objectContaining({ apiKey: 'new-token', env: 'staging' }),
      )
    })

    it('stores the new key in the provisioner secret, keeping other fields', async () => {
      const d = await wiredDeps({ apiKey: 'old', keyId: 'k-old', note: 'kept' })
      send.mockResolvedValueOnce({})
      await d.ownKey.store({
        apiKey: 'new-token',
        keyId: 'k-new',
        expiresAt: new Date('2027-10-05T12:00:00.000Z'),
      })
      const put = send.mock.calls.at(-1)![0]
      expect(put.name).toBe('PutSecretValue')
      expect(put.input.SecretId).toBe(SECRET_ARN)
      expect(JSON.parse(put.input.SecretString)).toEqual({
        apiKey: 'new-token',
        keyId: 'k-new',
        expiresAt: '2027-10-05T12:00:00.000Z',
        note: 'kept',
      })
    })
  })

  describe('platform key expiry', () => {
    it('reads the expiresAt tag through DescribeSecret (metadata only)', async () => {
      const d = await wiredDeps({ apiKey: 'k' })
      send.mockResolvedValueOnce({ Tags: [{ Key: 'expiresAt', Value: '2028-06-04T16:10:23Z' }] })
      expect(await d.platformKeyExpiresAt()).toEqual(new Date('2028-06-04T16:10:23Z'))
      const call = send.mock.calls.at(-1)![0]
      expect(call).toEqual({ name: 'DescribeSecret', input: { SecretId: PLATFORM_ARN } })
    })

    it.each([
      ['no tags', {}],
      ['no expiresAt tag', { Tags: [{ Key: 'Env', Value: 'staging' }] }],
      ['an invalid date', { Tags: [{ Key: 'expiresAt', Value: 'soon' }] }],
    ])('is null with %s', async (_label, described) => {
      const d = await wiredDeps({ apiKey: 'k' })
      send.mockResolvedValueOnce(described)
      expect(await d.platformKeyExpiresAt()).toBeNull()
    })

    it('is null, without a call, when no platform secret is configured', async () => {
      delete process.env['TEMPORAL_PLATFORM_SECRET_ARN']
      const d = await wiredDeps({ apiKey: 'k' })
      const calls = send.mock.calls.length
      expect(await d.platformKeyExpiresAt()).toBeNull()
      expect(send.mock.calls.length).toBe(calls)
    })
  })

  it('publishes gauges with a KeyClass dimension to Pegasus/Workflows', async () => {
    const d = await wiredDeps({ apiKey: 'k' })
    await d.publishMetrics([
      { name: 'TemporalKeyDaysToExpiry', keyClass: 'tenant', value: 40 },
      { name: 'TemporalKeyRotationFailed', value: 0 },
    ])
    const { input } = (cwSend.mock.calls[0] as unknown as [{ input: Record<string, unknown> }])[0]
    expect(input['Namespace']).toBe('Pegasus/Workflows')
    expect(input['MetricData']).toEqual([
      expect.objectContaining({
        MetricName: 'TemporalKeyDaysToExpiry',
        Value: 40,
        Dimensions: [{ Name: 'KeyClass', Value: 'tenant' }],
      }),
      expect.objectContaining({
        MetricName: 'TemporalKeyRotationFailed',
        Value: 0,
        Dimensions: [],
      }),
    ])
  })

  it('fails when the secret has no apiKey', async () => {
    send.mockResolvedValue({ SecretString: JSON.stringify({ other: 'x' }) })
    await expect(handler({ action: 'rotate', tenantId: 't' })).rejects.toThrow(/no apiKey/)
    expect(runTemporalProvisioner).not.toHaveBeenCalled()
  })

  it('fails when ENV_NAME is unset', async () => {
    delete process.env['ENV_NAME']
    send.mockResolvedValue({ SecretString: JSON.stringify({ apiKey: 'k' }) })
    await expect(handler({ action: 'rotate', tenantId: 't' })).rejects.toThrow(/ENV_NAME/)
  })
})
