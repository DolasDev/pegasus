import { describe, it, expect, vi, beforeEach } from 'vitest'

// KMS is mocked with a reversible codec so we can assert the encryption context
// and round-trip without touching AWS. The unit under test is the context
// binding + base64 plumbing, not KMS itself.
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

import { encryptSecretValue, decryptSecretValue } from './secret-value-crypto'

beforeEach(() => {
  mockSend.mockReset()
  commandInputs.length = 0
  process.env['WORKFLOW_TOKEN_KMS_KEY_ID'] = 'key-123'
})

describe('encryptSecretValue', () => {
  it('encrypts with the configured key and a tenant-bound encryption context', async () => {
    mockSend.mockResolvedValueOnce({ CiphertextBlob: Buffer.from('cipher-bytes', 'utf8') })
    const out = await encryptSecretValue('s3cr3t', 'tenant-a')

    expect(out).toBe(Buffer.from('cipher-bytes', 'utf8').toString('base64'))
    expect(commandInputs[0]?.type).toBe('Encrypt')
    expect(commandInputs[0]?.input).toMatchObject({
      KeyId: 'key-123',
      EncryptionContext: { purpose: 'workflow_secret_config', tenantId: 'tenant-a' },
    })
    expect((commandInputs[0]?.input['Plaintext'] as Buffer).toString('utf8')).toBe('s3cr3t')
  })

  it('throws when WORKFLOW_TOKEN_KMS_KEY_ID is unset', async () => {
    delete process.env['WORKFLOW_TOKEN_KMS_KEY_ID']
    await expect(encryptSecretValue('x', 'tenant-a')).rejects.toThrow(/WORKFLOW_TOKEN_KMS_KEY_ID/)
  })

  it('throws when KMS returns no CiphertextBlob', async () => {
    mockSend.mockResolvedValueOnce({})
    await expect(encryptSecretValue('x', 'tenant-a')).rejects.toThrow(/no CiphertextBlob/)
  })
})

describe('decryptSecretValue', () => {
  it('decrypts with the same tenant-bound encryption context', async () => {
    mockSend.mockResolvedValueOnce({ Plaintext: Buffer.from('s3cr3t', 'utf8') })
    const cipher = Buffer.from('cipher-bytes', 'utf8').toString('base64')
    const out = await decryptSecretValue(cipher, 'tenant-a')

    expect(out).toBe('s3cr3t')
    expect(commandInputs[0]?.type).toBe('Decrypt')
    expect(commandInputs[0]?.input).toMatchObject({
      EncryptionContext: { purpose: 'workflow_secret_config', tenantId: 'tenant-a' },
    })
    expect((commandInputs[0]?.input['CiphertextBlob'] as Buffer).toString('utf8')).toBe(
      'cipher-bytes',
    )
  })

  it('throws when KMS returns no Plaintext', async () => {
    mockSend.mockResolvedValueOnce({})
    await expect(decryptSecretValue('AAAA', 'tenant-a')).rejects.toThrow(/no Plaintext/)
  })
})
