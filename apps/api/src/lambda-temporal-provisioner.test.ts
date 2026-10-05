import { describe, it, expect, vi, beforeEach } from 'vitest'

const send = vi.fn()
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: vi.fn(function () {
    return { send }
  }),
  GetSecretValueCommand: vi.fn(function (input: unknown) {
    return { input }
  }),
}))

const runTemporalProvisioner = vi.fn(async () => ({ outcome: 'done' }))
vi.mock('./lib/temporal-provisioner', () => ({ runTemporalProvisioner }))
vi.mock('./db', () => ({ db: {} }))

const { handler } = await import('./lambda-temporal-provisioner')

describe('lambda-temporal-provisioner handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['TEMPORAL_PROVISIONER_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:1:secret:x'
    process.env['ENV_NAME'] = 'staging'
  })

  it.each([
    ['null', null],
    ['an unknown action', { action: 'explode', tenantId: 't' }],
    ['a provision with no tenant', { action: 'provision' }],
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

  it('accepts the scheduled sweep event', async () => {
    send.mockResolvedValue({ SecretString: JSON.stringify({ apiKey: 'k' }) })
    await handler({ action: 'retire-previous-keys' })
    expect(runTemporalProvisioner).toHaveBeenCalledWith(
      { action: 'retire-previous-keys' },
      expect.anything(),
    )
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
