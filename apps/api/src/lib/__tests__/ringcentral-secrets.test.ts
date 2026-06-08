import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSend, commandInputs, FakeResourceExistsException } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  commandInputs: [] as Array<{ type: string; input: unknown }>,
  FakeResourceExistsException: class extends Error {},
}))

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = mockSend
  },
  CreateSecretCommand: class {
    constructor(public input: unknown) {
      commandInputs.push({ type: 'CreateSecret', input })
    }
  },
  PutSecretValueCommand: class {
    constructor(public input: unknown) {
      commandInputs.push({ type: 'PutSecretValue', input })
    }
  },
  GetSecretValueCommand: class {
    constructor(public input: unknown) {
      commandInputs.push({ type: 'GetSecretValue', input })
    }
  },
  ResourceExistsException: FakeResourceExistsException,
}))

import {
  storeRefreshToken,
  getRefreshToken,
  refreshTokenSecretName,
  __resetSecretsClientForTests,
} from '../ringcentral-secrets'

beforeEach(() => {
  mockSend.mockReset()
  commandInputs.length = 0
  __resetSecretsClientForTests()
  process.env['RINGCENTRAL_SECRET_PREFIX'] = 'pegasus/test/ringcentral'
})

describe('refreshTokenSecretName', () => {
  it('joins the configured prefix and connection id', () => {
    expect(refreshTokenSecretName('conn-1')).toBe('pegasus/test/ringcentral/conn-1')
  })
})

describe('storeRefreshToken', () => {
  it('creates a new secret and returns its ARN', async () => {
    mockSend.mockResolvedValueOnce({ ARN: 'arn:aws:secretsmanager:::secret:rc/conn-1' })
    const arn = await storeRefreshToken('conn-1', 'refresh-token-value')
    expect(arn).toBe('arn:aws:secretsmanager:::secret:rc/conn-1')
    expect(commandInputs[0]).toEqual({
      type: 'CreateSecret',
      input: { Name: 'pegasus/test/ringcentral/conn-1', SecretString: 'refresh-token-value' },
    })
  })

  it('falls back to PutSecretValue when the secret already exists (re-connect)', async () => {
    mockSend
      .mockRejectedValueOnce(new FakeResourceExistsException('exists'))
      .mockResolvedValueOnce({ ARN: 'arn:aws:secretsmanager:::secret:rc/conn-1' })
    const arn = await storeRefreshToken('conn-1', 'rotated-token')
    expect(arn).toBe('arn:aws:secretsmanager:::secret:rc/conn-1')
    expect(commandInputs.map((c) => c.type)).toEqual(['CreateSecret', 'PutSecretValue'])
  })

  it('rethrows non-ResourceExists errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'))
    await expect(storeRefreshToken('conn-1', 't')).rejects.toThrow(/AccessDenied/)
  })
})

describe('getRefreshToken', () => {
  it('returns the secret string', async () => {
    mockSend.mockResolvedValueOnce({ SecretString: 'the-refresh-token' })
    expect(await getRefreshToken('arn:secret')).toBe('the-refresh-token')
  })

  it('throws when the secret has no string value', async () => {
    mockSend.mockResolvedValueOnce({})
    await expect(getRefreshToken('arn:secret')).rejects.toThrow(/no string value/)
  })
})
