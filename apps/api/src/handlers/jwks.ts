// ---------------------------------------------------------------------------
// GET /.well-known/jwks.json — the public keys pegII sites use to verify
// cloud-issued pegII tokens (lib/pegii-token.ts; "Token contract (I1 ↔ I2)" in
// plans/todo/cloud-identity-and-companies.md).
//
// Public by design: it carries only public key material. Mounted at the app root
// beside /health, outside tenant middleware; the API CDN's default behaviour
// forwards every path. Publishes EVERY id in PEGII_TOKEN_KMS_KEY_IDS (current
// signer first) so a rotation overlaps: a site that sees an unknown `kid`
// re-fetches and finds the new key here before tokens are signed with it.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { createPublicKey } from 'node:crypto'
import { KMSClient, GetPublicKeyCommand } from '@aws-sdk/client-kms'
import { exportJWK, type JWK } from 'jose'
import { pegiiTokenKeyIds } from '../lib/pegii-token'
import { logger } from '../lib/logger'

/** Returns a key's DER-encoded SubjectPublicKeyInfo. */
export type PublicKeyFetcher = (keyId: string) => Promise<Uint8Array>

let kms: KMSClient | null = null
const kmsPublicKey: PublicKeyFetcher = async (keyId) => {
  kms ??= new KMSClient({})
  const out = await kms.send(new GetPublicKeyCommand({ KeyId: keyId }))
  if (!out.PublicKey) throw new Error(`KMS returned no public key for ${keyId}`)
  return out.PublicKey
}

const jwkCache = new Map<string, JWK>()

/** Test seam. */
export function __resetJwksCacheForTests(): void {
  jwkCache.clear()
}

/** Build the JWKS document for the given key ids (cached per key id; keys are immutable). */
export async function buildJwks(
  keyIds: string[],
  fetchPublicKey: PublicKeyFetcher = kmsPublicKey,
): Promise<{ keys: JWK[] }> {
  const keys: JWK[] = []
  for (const keyId of keyIds) {
    let jwk = jwkCache.get(keyId)
    if (!jwk) {
      const der = await fetchPublicKey(keyId)
      const publicKey = createPublicKey({ key: Buffer.from(der), format: 'der', type: 'spki' })
      jwk = { ...(await exportJWK(publicKey)), kid: keyId, alg: 'ES256', use: 'sig' }
      jwkCache.set(keyId, jwk)
    }
    keys.push(jwk)
  }
  return { keys }
}

export function createJwksHandler(
  opts: { keyIds?: () => string[]; fetchPublicKey?: PublicKeyFetcher } = {},
): Hono {
  const keyIds = opts.keyIds ?? pegiiTokenKeyIds
  const handler = new Hono()
  handler.get('/', async (c) => {
    try {
      const jwks = await buildJwks(keyIds(), opts.fetchPublicKey)
      c.header('Cache-Control', 'public, max-age=300')
      return c.json(jwks)
    } catch (err) {
      logger.error('JWKS build failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      return c.json({ error: 'signing keys unavailable', code: 'JWKS_UNAVAILABLE' }, 503)
    }
  })
  return handler
}

export const jwksHandler = createJwksHandler()
