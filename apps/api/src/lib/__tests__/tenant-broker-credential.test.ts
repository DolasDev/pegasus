// ---------------------------------------------------------------------------
// Tests for per-tenant workflow-broker credentials (Phase 3 Unit 7).
//
// Two layers:
//   * Pure token-shape tests (parseTenantBrokerToken) — always run.
//   * Integration tests against a live Postgres (skipped without
//     DATABASE_URL): provisioning idempotency, verification, rotation
//     revoking the previous token.
//
// KMS is mocked with a reversible base64 codec — the unit under test is the
// storage/verification logic, not AWS KMS. The real encrypt/decrypt helpers
// are covered by Phase 2's runtime-token flow.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { db } from '../../db'
import {
  parseTenantBrokerToken,
  getOrCreateTenantBrokerCredential,
  rotateTenantBrokerCredential,
  verifyTenantBrokerToken,
} from '../tenant-broker-credential'

vi.mock('../runtime-token-crypto', () => ({
  encryptRuntimeToken: vi.fn((plaintext: string) =>
    Promise.resolve(Buffer.from(plaintext, 'utf8').toString('base64')),
  ),
  decryptRuntimeToken: vi.fn((ciphertext: string) =>
    Promise.resolve(Buffer.from(ciphertext, 'base64').toString('utf8')),
  ),
}))

const hasDb = Boolean(process.env['DATABASE_URL'])

const SOME_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeffff'
const HEX48 = 'ab'.repeat(24)

// ---------------------------------------------------------------------------
// Pure: token shape
// ---------------------------------------------------------------------------

describe('parseTenantBrokerToken', () => {
  it('extracts the tenantId from a well-formed token', () => {
    expect(parseTenantBrokerToken(`wbk_${SOME_UUID}_${HEX48}`)).toEqual({
      tenantId: SOME_UUID,
    })
  })

  it.each([
    ['empty string', ''],
    ['garbage', 'not-a-token'],
    ['vnd_ runtime-token prefix', `vnd_${HEX48}`],
    ['missing secret part', `wbk_${SOME_UUID}`],
    ['secret too short', `wbk_${SOME_UUID}_${'ab'.repeat(23)}`],
    ['secret too long', `wbk_${SOME_UUID}_${'ab'.repeat(25)}`],
    ['non-hex secret', `wbk_${SOME_UUID}_${'zz'.repeat(24)}`],
    ['uppercase secret', `wbk_${SOME_UUID}_${'AB'.repeat(24)}`],
    ['malformed uuid', `wbk_not-a-uuid_${HEX48}`],
    ['trailing junk', `wbk_${SOME_UUID}_${HEX48}x`],
    ['leading junk', `xwbk_${SOME_UUID}_${HEX48}`],
  ])('rejects %s', (_label, token) => {
    expect(parseTenantBrokerToken(token)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Integration: provisioning / verification / rotation
// ---------------------------------------------------------------------------

const TEST_TENANT_SLUG = 'test-tenant-broker-credential'
let tenantId: string

afterAll(async () => {
  if (hasDb) {
    await db.tenantBrokerCredential.deleteMany({ where: { tenantId } })
    await db.tenant.deleteMany({ where: { slug: TEST_TENANT_SLUG } })
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('tenant broker credential provisioning (integration)', () => {
  beforeAll(async () => {
    const tenant = await db.tenant.upsert({
      where: { slug: TEST_TENANT_SLUG },
      create: { name: 'Test Tenant (Broker Credential)', slug: TEST_TENANT_SLUG },
      update: {},
    })
    tenantId = tenant.id
    await db.tenantBrokerCredential.deleteMany({ where: { tenantId } })
  })

  it('mints, persists hash + ciphertext, and embeds the tenantId', async () => {
    const token = await getOrCreateTenantBrokerCredential(db, tenantId)

    expect(token).toMatch(/^wbk_[0-9a-f-]{36}_[0-9a-f]{48}$/)
    expect(parseTenantBrokerToken(token)).toEqual({ tenantId })

    const row = await db.tenantBrokerCredential.findUnique({ where: { tenantId } })
    expect(row).not.toBeNull()
    // At-rest broker form: SHA-256 of the full token, never the plaintext.
    expect(row!.tokenHash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(row!.tokenHash).not.toBe(token)
    // At-rest dispatcher form: (mock-)KMS ciphertext that decrypts back to it.
    expect(Buffer.from(row!.tokenCiphertext, 'base64').toString('utf8')).toBe(token)
    expect(row!.rotatedAt).toBeNull()
  })

  it('is idempotent — a second getOrCreate returns the SAME token, no re-mint', async () => {
    const first = await getOrCreateTenantBrokerCredential(db, tenantId)
    const firstRow = await db.tenantBrokerCredential.findUnique({ where: { tenantId } })

    const second = await getOrCreateTenantBrokerCredential(db, tenantId)
    const secondRow = await db.tenantBrokerCredential.findUnique({ where: { tenantId } })

    expect(second).toBe(first)
    expect(secondRow!.id).toBe(firstRow!.id)
    expect(secondRow!.tokenHash).toBe(firstRow!.tokenHash)
    expect(secondRow!.updatedAt.getTime()).toBe(firstRow!.updatedAt.getTime())
    expect(await db.tenantBrokerCredential.count({ where: { tenantId } })).toBe(1)
  })

  it('verifies the minted token and rejects near-misses', async () => {
    const token = await getOrCreateTenantBrokerCredential(db, tenantId)

    expect(await verifyTenantBrokerToken(db, token)).toEqual({ tenantId })

    // Same shape, last secret char flipped → hash mismatch.
    const flipped = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0')
    expect(await verifyTenantBrokerToken(db, flipped)).toBeNull()

    // Valid shape but a tenant with no credential row.
    expect(await verifyTenantBrokerToken(db, `wbk_${SOME_UUID}_${HEX48}`)).toBeNull()

    // A different tenant's id spliced onto this tenant's secret must fail:
    // the embedded id selects the row, the hash is of the FULL token.
    const secret = token.split('_').at(-1)!
    expect(await verifyTenantBrokerToken(db, `wbk_${SOME_UUID}_${secret}`)).toBeNull()

    expect(await verifyTenantBrokerToken(db, 'garbage')).toBeNull()
  })

  it('rotation revokes the previous token immediately', async () => {
    const oldToken = await getOrCreateTenantBrokerCredential(db, tenantId)
    const newToken = await rotateTenantBrokerCredential(db, tenantId)

    expect(newToken).not.toBe(oldToken)
    expect(parseTenantBrokerToken(newToken)).toEqual({ tenantId })

    expect(await verifyTenantBrokerToken(db, oldToken)).toBeNull()
    expect(await verifyTenantBrokerToken(db, newToken)).toEqual({ tenantId })

    const row = await db.tenantBrokerCredential.findUnique({ where: { tenantId } })
    expect(row!.rotatedAt).not.toBeNull()
    // Still exactly one credential per tenant.
    expect(await db.tenantBrokerCredential.count({ where: { tenantId } })).toBe(1)

    // getOrCreate after a rotation returns the rotated token, not a fresh one.
    expect(await getOrCreateTenantBrokerCredential(db, tenantId)).toBe(newToken)
  })
})
