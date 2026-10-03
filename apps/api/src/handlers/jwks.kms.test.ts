// The JWKS handler's default public-key fetcher: KMS GetPublicKey, one call per
// key id, DER SPKI → JWK. The KMS client is module-mocked (no AWS access).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@aws-sdk/client-kms', () => ({
  KMSClient: class {
    send = send
  },
  GetPublicKeyCommand: class {
    constructor(public input: unknown) {}
  },
}))

import { buildJwks, __resetJwksCacheForTests } from './jwks'

beforeEach(() => {
  vi.clearAllMocks()
  __resetJwksCacheForTests()
})

describe('buildJwks with the default KMS fetcher', () => {
  it('reads each key with GetPublicKey and publishes it as an ES256 JWK', async () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    send.mockResolvedValue({
      PublicKey: new Uint8Array(publicKey.export({ format: 'der', type: 'spki' })),
    })

    const jwks = await buildJwks(['kms-key-1'])

    expect(send).toHaveBeenCalledWith({ input: { KeyId: 'kms-key-1' } })
    expect(jwks.keys).toEqual([
      expect.objectContaining({ kty: 'EC', crv: 'P-256', kid: 'kms-key-1', alg: 'ES256' }),
    ])
  })

  it('fails when KMS returns no public key', async () => {
    send.mockResolvedValue({})

    await expect(buildJwks(['kms-key-1'])).rejects.toThrow(/no public key/)
  })
})
