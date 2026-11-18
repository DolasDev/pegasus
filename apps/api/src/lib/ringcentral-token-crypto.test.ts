import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// KMS is mocked so the test pins the key id, the connection-bound encryption
// context and the base64 plumbing — not KMS itself.
const { mockSend, commandInputs } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  commandInputs: [] as Array<{ type: string; input: Record<string, unknown> }>,
}))

vi.mock('@aws-sdk/client-kms', () => ({
  KMSClient: class {
    send = mockSend
  },
  EncryptCommand: class {
    constructor(public input: Record<string, unknown>) {
      commandInputs.push({ type: 'Encrypt', input })
    }
  },
  DecryptCommand: class {
    constructor(public input: Record<string, unknown>) {
      commandInputs.push({ type: 'Decrypt', input })
    }
  },
}))

import {
  encryptRingCentralToken,
  decryptRingCentralToken,
  isRingCentralTokenCryptoConfigured,
} from './ringcentral-token-crypto'

const saved = process.env['WORKFLOW_TOKEN_KMS_KEY_ID']

beforeEach(() => {
  mockSend.mockReset()
  commandInputs.length = 0
  process.env['WORKFLOW_TOKEN_KMS_KEY_ID'] = 'key-123'
})

afterEach(() => {
  if (saved === undefined) delete process.env['WORKFLOW_TOKEN_KMS_KEY_ID']
  else process.env['WORKFLOW_TOKEN_KMS_KEY_ID'] = saved
})

const CONTEXT = { purpose: 'ringcentral_access_token', connectionId: 'conn-1' }

describe('encryptRingCentralToken', () => {
  it('encrypts with the configured key, bound to the connection', async () => {
    mockSend.mockResolvedValueOnce({ CiphertextBlob: Buffer.from('cipher', 'utf8') })

    const out = await encryptRingCentralToken('access-token', 'conn-1')

    expect(out).toBe(Buffer.from('cipher', 'utf8').toString('base64'))
    expect(commandInputs).toEqual([
      {
        type: 'Encrypt',
        input: {
          KeyId: 'key-123',
          Plaintext: Buffer.from('access-token', 'utf8'),
          EncryptionContext: CONTEXT,
        },
      },
    ])
  })

  it('throws when the key id is not configured', async () => {
    delete process.env['WORKFLOW_TOKEN_KMS_KEY_ID']
    await expect(encryptRingCentralToken('t', 'conn-1')).rejects.toThrow(
      /WORKFLOW_TOKEN_KMS_KEY_ID/,
    )
  })
})

describe('decryptRingCentralToken', () => {
  it('decrypts with the same connection-bound context', async () => {
    mockSend.mockResolvedValueOnce({ Plaintext: Buffer.from('access-token', 'utf8') })

    const out = await decryptRingCentralToken(Buffer.from('cipher').toString('base64'), 'conn-1')

    expect(out).toBe('access-token')
    expect(commandInputs[0]).toEqual({
      type: 'Decrypt',
      input: { CiphertextBlob: Buffer.from('cipher'), EncryptionContext: CONTEXT },
    })
  })
})

describe('isRingCentralTokenCryptoConfigured', () => {
  it('reflects whether the key id is set', () => {
    expect(isRingCentralTokenCryptoConfigured({ WORKFLOW_TOKEN_KMS_KEY_ID: 'k' })).toBe(true)
    expect(isRingCentralTokenCryptoConfigured({})).toBe(false)
  })
})
