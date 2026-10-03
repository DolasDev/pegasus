import { describe, it, expect, beforeEach, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose'
import { createJwksHandler, __resetJwksCacheForTests } from './jwks'
import { createLocalSigner } from '../lib/pegii-signer'
import { createPegiiTokenMinter, pegiiSiteAudience } from '../lib/pegii-token'

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return { privateKey, der: new Uint8Array(publicKey.export({ format: 'der', type: 'spki' })) }
}

beforeEach(() => __resetJwksCacheForTests())

describe('GET /.well-known/jwks.json', () => {
  it('publishes every configured key, current first, with only public material', async () => {
    const a = keyPair()
    const b = keyPair()
    const ders: Record<string, Uint8Array> = { 'key-a': a.der, 'key-b': b.der }
    const app = createJwksHandler({
      keyIds: () => ['key-a', 'key-b'],
      fetchPublicKey: async (id) => ders[id]!,
    })

    const res = await app.request('/')

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=300')
    const body = (await res.json()) as { keys: Record<string, unknown>[] }
    expect(body.keys.map((k) => k['kid'])).toEqual(['key-a', 'key-b'])
    for (const k of body.keys) {
      expect(k).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' })
      expect(k).not.toHaveProperty('d')
    }
  })

  it('serves keys that verify tokens the minter signs', async () => {
    const k = keyPair()
    const app = createJwksHandler({ keyIds: () => ['key-a'], fetchPublicKey: async () => k.der })
    const minter = createPegiiTokenMinter({
      signer: createLocalSigner({ keyId: 'key-a', privateKey: k.privateKey }),
      issuer: 'https://issuer.test',
    })
    const token = await minter.mint({
      tenantId: 't',
      siteId: 's',
      company: { dataSourceKey: null, systemEmployeeCode: null },
      principal: { tenantUserId: 'u', isServiceAccount: false },
    })

    const jwks = (await (await app.request('/')).json()) as JSONWebKeySet

    await expect(
      jwtVerify(token, createLocalJWKSet(jwks), {
        issuer: 'https://issuer.test',
        audience: pegiiSiteAudience('s'),
      }),
    ).resolves.toBeDefined()
  })

  it('fetches each public key once (keys are immutable)', async () => {
    const k = keyPair()
    const fetchPublicKey = vi.fn(async () => k.der)
    const app = createJwksHandler({ keyIds: () => ['key-a'], fetchPublicKey })

    await app.request('/')
    await app.request('/')

    expect(fetchPublicKey).toHaveBeenCalledTimes(1)
  })

  it('answers 503 when a key cannot be read', async () => {
    const app = createJwksHandler({
      keyIds: () => ['key-a'],
      fetchPublicKey: async () => {
        throw new Error('AccessDenied')
      },
    })

    const res = await app.request('/')

    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: 'JWKS_UNAVAILABLE' })
  })
})
