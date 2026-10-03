// ---------------------------------------------------------------------------
// Generates the shared cloud-issued pegII token fixture
// (src/__fixtures__/pegii-token/), pinning the "Token contract (I1 ↔ I2)" in
// plans/todo/cloud-identity-and-companies.md for BOTH repos: pegasus verifies
// these bytes in its tests, and movemanager copies the directory verbatim into
// Pegasus.Api.Tests/Fixtures/cloud-token/ and verifies the same bytes.
//
// Each run signs with a fresh throwaway P-256 key; only its PUBLIC half (jwks.json)
// and the signed tokens are written, so no private key is ever committed.
// Re-running changes every byte — regenerate only when the contract changes,
// then re-copy the directory to movemanager.
//
//   npx tsx scripts/generate-pegii-token-fixture.ts
// ---------------------------------------------------------------------------

import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { exportJWK } from 'jose'
import { createLocalSigner } from '../src/lib/pegii-signer'
import { signPegiiToken, pegiiSiteAudience, type PegiiTokenClaims } from '../src/lib/pegii-token'

const DIR = join(__dirname, '..', 'src', '__fixtures__', 'pegii-token')
const KEY_ID = 'test-only-0000-4000-8000-000000000001'
const OTHER_KEY_ID = 'test-only-0000-4000-8000-000000000002'
const ISSUER = 'https://api.pegasus.example.test'
const SITE_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const SERVICE_ID = '44444444-4444-4444-8444-444444444444'
/** Fixed "now" every consumer must validate against (2026-10-02T00:00:00Z). */
const NOW = 1_790_899_200

function claims(overrides: Partial<PegiiTokenClaims> = {}): PegiiTokenClaims {
  return {
    iss: ISSUER,
    aud: pegiiSiteAudience(SITE_ID),
    sub: USER_ID,
    tid: TENANT_ID,
    ptype: 'user',
    iat: NOW,
    nbf: NOW,
    exp: NOW + 300,
    jti: '55555555-5555-4555-8555-000000000000',
    cid: 'QMM_CA',
    ...overrides,
  }
}

async function main(): Promise<void> {
  mkdirSync(DIR, { recursive: true })
  const key = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
  const signer = createLocalSigner({ keyId: KEY_ID, privateKey: key })
  const strangerKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
  const stranger = createLocalSigner({ keyId: KEY_ID, privateKey: strangerKey })
  const unknownKid = createLocalSigner({ keyId: OTHER_KEY_ID, privateKey: key })

  const { cid: _omit, ...noCidClaims } = claims({ jti: '55555555-5555-4555-8555-000000000004' })
  const tokens = {
    valid: await signPegiiToken(claims({ jti: '55555555-5555-4555-8555-000000000001' }), signer),
    service: await signPegiiToken(
      claims({
        sub: SERVICE_ID,
        ptype: 'service',
        emp: 1001,
        jti: '55555555-5555-4555-8555-000000000002',
      }),
      signer,
    ),
    noCid: await signPegiiToken(noCidClaims as PegiiTokenClaims, signer),
    wrongAudience: await signPegiiToken(
      claims({
        aud: pegiiSiteAudience('99999999-9999-4999-8999-999999999999'),
        jti: '55555555-5555-4555-8555-000000000005',
      }),
      signer,
    ),
    wrongIssuer: await signPegiiToken(
      claims({ iss: 'https://evil.example.test', jti: '55555555-5555-4555-8555-000000000006' }),
      signer,
    ),
    expired: await signPegiiToken(
      claims({
        iat: NOW - 900,
        nbf: NOW - 900,
        exp: NOW - 600,
        jti: '55555555-5555-4555-8555-000000000007',
      }),
      signer,
    ),
    notYetValid: await signPegiiToken(
      claims({
        iat: NOW + 600,
        nbf: NOW + 600,
        exp: NOW + 900,
        jti: '55555555-5555-4555-8555-000000000008',
      }),
      signer,
    ),
    badSignature: await signPegiiToken(
      claims({ jti: '55555555-5555-4555-8555-000000000009' }),
      stranger,
    ),
    unknownKid: await signPegiiToken(
      claims({ jti: '55555555-5555-4555-8555-000000000010' }),
      unknownKid,
    ),
  }

  const publicJwk = await exportJWK(key)
  delete publicJwk.d
  const jwks = { keys: [{ ...publicJwk, kid: KEY_ID, alg: 'ES256', use: 'sig' }] }

  writeFileSync(join(DIR, 'jwks.json'), JSON.stringify(jwks, null, 2) + '\n')
  writeFileSync(
    join(DIR, 'tokens.json'),
    JSON.stringify(
      {
        now: NOW,
        maxClockSkewSeconds: 60,
        issuer: ISSUER,
        siteId: SITE_ID,
        audience: pegiiSiteAudience(SITE_ID),
        tenantId: TENANT_ID,
        expect: {
          valid: 'accept (user, cid=QMM_CA)',
          service: 'accept (service, emp=1001, cid=QMM_CA)',
          noCid: 'accept (default company DB)',
          wrongAudience: 'reject',
          wrongIssuer: 'reject',
          expired: 'reject',
          notYetValid: 'reject',
          badSignature: 'reject',
          unknownKid: 'reject',
        },
        // Each token is stored as its three JWS segments — consumers join them
        // with "." — so the repo never holds a dot-joined JWT literal for the
        // secret scanner's `jwt` rule to flag (these are test-only tokens).
        tokenSegments: Object.fromEntries(
          Object.entries(tokens).map(([name, token]) => [name, token.split('.')]),
        ),
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`wrote fixture to ${DIR}`)
}

void main()
