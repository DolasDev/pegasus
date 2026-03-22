// ---------------------------------------------------------------------------
// Unit tests for packages/api/src/lib/env.ts
//
// Validates that validateEnv() correctly enforces required environment
// variables and provides clear error messages on misconfiguration.
//
// These tests manipulate process.env directly and restore it after each
// case — they have no side effects on other test modules.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Env snapshot helpers
// ---------------------------------------------------------------------------

const REQUIRED_VARS = [
  'DATABASE_URL',
  'COGNITO_JWKS_URL',
  'COGNITO_TENANT_CLIENT_ID',
  'COGNITO_USER_POOL_ID',
  'SKIP_AUTH',
] as const

type EnvSnapshot = Partial<Record<(typeof REQUIRED_VARS)[number], string | undefined>>

function captureEnv(): EnvSnapshot {
  const snap: EnvSnapshot = {}
  for (const key of REQUIRED_VARS) {
    snap[key] = process.env[key]
  }
  return snap
}

function restoreEnv(snap: EnvSnapshot): void {
  for (const key of REQUIRED_VARS) {
    const val = snap[key]
    if (val === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = val
    }
  }
}

function setValidFullEnv(): void {
  process.env['DATABASE_URL'] = 'postgresql://user:pass@localhost:5432/pegasus'
  process.env['COGNITO_JWKS_URL'] =
    'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test/.well-known/jwks.json'
  process.env['COGNITO_TENANT_CLIENT_ID'] = 'test-client-id'
  process.env['COGNITO_USER_POOL_ID'] = 'us-east-1_testPoolId'
  delete process.env['SKIP_AUTH']
}

function setValidSkipAuthEnv(): void {
  process.env['DATABASE_URL'] = 'postgresql://user:pass@localhost:5432/pegasus'
  process.env['SKIP_AUTH'] = 'true'
  delete process.env['COGNITO_JWKS_URL']
  delete process.env['COGNITO_TENANT_CLIENT_ID']
  delete process.env['COGNITO_USER_POOL_ID']
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateEnv()', () => {
  let snapshot: EnvSnapshot

  beforeEach(() => {
    snapshot = captureEnv()
  })

  afterEach(() => {
    restoreEnv(snapshot)
  })

  // ── Valid env — full Cognito config ────────────────────────────────────────

  it('does not throw when all required vars are present', async () => {
    setValidFullEnv()
    const { validateEnv } = await import('../env')
    expect(() => validateEnv()).not.toThrow()
  })

  it('returns a typed env object with all validated values', async () => {
    setValidFullEnv()
    const { validateEnv } = await import('../env')
    const env = validateEnv()
    expect(env.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/pegasus')
    expect(env.COGNITO_JWKS_URL).toContain('cognito-idp')
    expect(env.COGNITO_TENANT_CLIENT_ID).toBe('test-client-id')
    expect(env.COGNITO_USER_POOL_ID).toBe('us-east-1_testPoolId')
  })

  // ── SKIP_AUTH mode — Cognito vars become optional ─────────────────────────

  it('does not throw when SKIP_AUTH=true and Cognito vars are absent', async () => {
    setValidSkipAuthEnv()
    const { validateEnv } = await import('../env')
    expect(() => validateEnv()).not.toThrow()
  })

  it('returns SKIP_AUTH=true in the env object when set', async () => {
    setValidSkipAuthEnv()
    const { validateEnv } = await import('../env')
    const env = validateEnv()
    expect(env.SKIP_AUTH).toBe('true')
    expect(env.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/pegasus')
  })

  // ── Missing DATABASE_URL — always required ─────────────────────────────────

  it('throws when DATABASE_URL is missing (full Cognito mode)', async () => {
    setValidFullEnv()
    delete process.env['DATABASE_URL']
    const { validateEnv } = await import('../env')
    expect(() => validateEnv()).toThrow(/DATABASE_URL/)
  })

  it('throws when DATABASE_URL is missing even with SKIP_AUTH=true', async () => {
    setValidSkipAuthEnv()
    delete process.env['DATABASE_URL']
    const { validateEnv } = await import('../env')
    expect(() => validateEnv()).toThrow(/DATABASE_URL/)
  })

  it('throws when DATABASE_URL is an empty string', async () => {
    setValidFullEnv()
    process.env['DATABASE_URL'] = ''
    const { validateEnv } = await import('../env')
    expect(() => validateEnv()).toThrow(/DATABASE_URL/)
  })

  // ── Missing Cognito vars (non-SKIP_AUTH mode) ──────────────────────────────

  it('throws when COGNITO_JWKS_URL is missing', async () => {
    setValidFullEnv()
    delete process.env['COGNITO_JWKS_URL']
    const { validateEnv } = await import('../env')
    expect(() => validateEnv()).toThrow(/COGNITO_JWKS_URL/)
  })

  it('throws when COGNITO_TENANT_CLIENT_ID is missing', async () => {
    setValidFullEnv()
    delete process.env['COGNITO_TENANT_CLIENT_ID']
    const { validateEnv } = await import('../env')
    expect(() => validateEnv()).toThrow(/COGNITO_TENANT_CLIENT_ID/)
  })

  it('throws when COGNITO_USER_POOL_ID is missing', async () => {
    setValidFullEnv()
    delete process.env['COGNITO_USER_POOL_ID']
    const { validateEnv } = await import('../env')
    expect(() => validateEnv()).toThrow(/COGNITO_USER_POOL_ID/)
  })

  it('throws when COGNITO_JWKS_URL is an empty string', async () => {
    setValidFullEnv()
    process.env['COGNITO_JWKS_URL'] = ''
    const { validateEnv } = await import('../env')
    expect(() => validateEnv()).toThrow(/COGNITO_JWKS_URL/)
  })

  // ── Error message quality ──────────────────────────────────────────────────

  it('error message lists all missing vars', async () => {
    process.env['DATABASE_URL'] = 'postgresql://user:pass@localhost:5432/pegasus'
    delete process.env['SKIP_AUTH']
    delete process.env['COGNITO_JWKS_URL']
    delete process.env['COGNITO_TENANT_CLIENT_ID']
    delete process.env['COGNITO_USER_POOL_ID']
    const { validateEnv } = await import('../env')
    let message = ''
    try {
      validateEnv()
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain('COGNITO_JWKS_URL')
    expect(message).toContain('COGNITO_TENANT_CLIENT_ID')
    expect(message).toContain('COGNITO_USER_POOL_ID')
  })
})
