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
  storeConnectionCredentials,
  getConnectionCredentials,
  connectionSecretName,
  __resetSecretsClientForTests,
} from '../ringcentral-secrets'

const CREDS = { clientId: 'cid', clientSecret: 'csec', jwt: 'the-jwt' }

beforeEach(() => {
  mockSend.mockReset()
  commandInputs.length = 0
  __resetSecretsClientForTests()
  process.env['RINGCENTRAL_SECRET_PREFIX'] = 'pegasus/test/ringcentral'
})

describe('connectionSecretName', () => {
  it('joins the configured prefix and connection id', () => {
    expect(connectionSecretName('conn-1')).toBe('pegasus/test/ringcentral/conn-1')
  })
})

describe('storeConnectionCredentials', () => {
  it('creates a new secret with the JSON blob and returns its ARN', async () => {
    mockSend.mockResolvedValueOnce({ ARN: 'arn:aws:secretsmanager:::secret:rc/conn-1' })
    const arn = await storeConnectionCredentials('conn-1', CREDS)
    expect(arn).toBe('arn:aws:secretsmanager:::secret:rc/conn-1')
    expect(commandInputs[0]).toEqual({
      type: 'CreateSecret',
      input: { Name: 'pegasus/test/ringcentral/conn-1', SecretString: JSON.stringify(CREDS) },
    })
  })

  it('falls back to PutSecretValue when the secret already exists (re-connect)', async () => {
    mockSend
      .mockRejectedValueOnce(new FakeResourceExistsException('exists'))
      .mockResolvedValueOnce({ ARN: 'arn:aws:secretsmanager:::secret:rc/conn-1' })
    const arn = await storeConnectionCredentials('conn-1', CREDS)
    expect(arn).toBe('arn:aws:secretsmanager:::secret:rc/conn-1')
    expect(commandInputs.map((c) => c.type)).toEqual(['CreateSecret', 'PutSecretValue'])
  })

  it('rethrows non-ResourceExists errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'))
    await expect(storeConnectionCredentials('conn-1', CREDS)).rejects.toThrow(/AccessDenied/)
  })
})

describe('getConnectionCredentials', () => {
  it('parses the stored JSON blob', async () => {
    mockSend.mockResolvedValueOnce({ SecretString: JSON.stringify(CREDS) })
    expect(await getConnectionCredentials('arn:secret')).toEqual(CREDS)
  })

  it('throws when the secret has no string value', async () => {
    mockSend.mockResolvedValueOnce({})
    await expect(getConnectionCredentials('arn:secret')).rejects.toThrow(/no string value/)
  })
})
