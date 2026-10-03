// Env-driven configuration of the process-wide pegII token minter, and the
// adapter to the pegII client's auth seam.

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  __setPegiiTokenMinterForTests,
  createCloudTokenProvider,
  getPegiiTokenMinter,
  pegiiTokenKeyIds,
  type MintPegiiTokenInput,
  type PegiiTokenMinter,
} from '../pegii-token'
import { PegiiApiError } from '../pegii-api-error'

const ENV_KEYS = ['PEGII_TOKEN_KMS_KEY_IDS', 'PEGII_TOKEN_ISSUER'] as const

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
  __setPegiiTokenMinterForTests(null)
})

describe('pegiiTokenKeyIds', () => {
  it('parses a comma-separated list, current first, ignoring blanks', () => {
    process.env['PEGII_TOKEN_KMS_KEY_IDS'] = ' key-new , ,key-old,'
    expect(pegiiTokenKeyIds()).toEqual(['key-new', 'key-old'])
  })

  it('is empty when unset', () => {
    expect(pegiiTokenKeyIds()).toEqual([])
  })
})

describe('getPegiiTokenMinter', () => {
  it.each([
    [{ PEGII_TOKEN_ISSUER: 'https://api.test' }],
    [{ PEGII_TOKEN_KMS_KEY_IDS: 'key-1' }],
    [{}],
  ])('refuses with PEGII_TOKEN_NOT_CONFIGURED when the env is incomplete (%j)', (env) => {
    Object.assign(process.env, env)

    let err: unknown
    try {
      getPegiiTokenMinter()
    } catch (e) {
      err = e
    }

    expect(err).toBeInstanceOf(PegiiApiError)
    expect((err as PegiiApiError).code).toBe('PEGII_TOKEN_NOT_CONFIGURED')
  })

  it('builds one KMS-backed minter from the env and reuses it (no network until mint)', () => {
    process.env['PEGII_TOKEN_KMS_KEY_IDS'] = 'key-1,key-0'
    process.env['PEGII_TOKEN_ISSUER'] = 'https://api.test'

    const minter = getPegiiTokenMinter()

    expect(getPegiiTokenMinter()).toBe(minter)
  })
})

describe('createCloudTokenProvider', () => {
  const input: MintPegiiTokenInput = {
    tenantId: 't',
    siteId: 's',
    company: { dataSourceKey: null, systemEmployeeCode: null },
    principal: { tenantUserId: 'u', isServiceAccount: false },
  }

  it('mints through the given minter and invalidates the same cache entry', async () => {
    const minter: PegiiTokenMinter = {
      mint: vi.fn().mockResolvedValue('tok'),
      invalidate: vi.fn(),
    }
    const provider = createCloudTokenProvider(input, () => minter)

    expect(await provider.getToken()).toBe('tok')
    provider.invalidate()

    expect(minter.mint).toHaveBeenCalledWith(input)
    expect(minter.invalidate).toHaveBeenCalledWith(input)
  })

  it('defaults to the process-wide minter', async () => {
    const minter: PegiiTokenMinter = {
      mint: vi.fn().mockResolvedValue('tok-2'),
      invalidate: vi.fn(),
    }
    __setPegiiTokenMinterForTests(minter)

    expect(await createCloudTokenProvider(input).getToken()).toBe('tok-2')
  })
})
