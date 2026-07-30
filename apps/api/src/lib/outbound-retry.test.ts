// ---------------------------------------------------------------------------
// Unit tests for the outbound retry policy.
//
// The riskiest property here is NOT the backoff maths — it is `isRetryable`.
// Auto-retrying a non-idempotent call double-writes at the partner (a duplicate
// shipment, a duplicate payment), so the predicate must refuse anything it is
// not certain is safe. That case gets the most coverage.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import {
  parseRetryAfterMs,
  isRetryableStatus,
  isIdempotent,
  backoffMs,
  retryDelayMs,
  MAX_RETRY_AFTER_MS,
  clampMaxRetries,
  clampTimeoutMs,
  DEFAULT_TIMEOUT_MS,
} from './outbound-retry'

const NOW = Date.UTC(2026, 6, 30, 12, 0, 0)

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfterMs('3', NOW)).toBe(3000)
    expect(parseRetryAfterMs('0', NOW)).toBe(0)
  })

  it('parses an HTTP-date into a delay relative to now', () => {
    expect(parseRetryAfterMs(new Date(NOW + 5000).toUTCString(), NOW)).toBe(5000)
  })

  it('caps at MAX_RETRY_AFTER_MS so a partner cannot stall the Lambda', () => {
    // APIM can legitimately return a 60s Retry-After on a quota reset; honoring
    // it verbatim would burn the request's whole time budget sleeping.
    expect(parseRetryAfterMs('600', NOW)).toBe(MAX_RETRY_AFTER_MS)
    expect(parseRetryAfterMs(new Date(NOW + 3_600_000).toUTCString(), NOW)).toBe(MAX_RETRY_AFTER_MS)
  })

  it('treats a past date and a negative delta as no delay', () => {
    expect(parseRetryAfterMs('-5', NOW)).toBe(0)
    expect(parseRetryAfterMs(new Date(NOW - 10_000).toUTCString(), NOW)).toBe(0)
  })

  it('returns null for absent or unparseable values', () => {
    expect(parseRetryAfterMs(null, NOW)).toBeNull()
    expect(parseRetryAfterMs(undefined, NOW)).toBeNull()
    expect(parseRetryAfterMs('', NOW)).toBeNull()
    expect(parseRetryAfterMs('soon', NOW)).toBeNull()
    expect(parseRetryAfterMs('3.7', NOW)).toBeNull()
  })
})

describe('isRetryableStatus', () => {
  it('retries only 429 and 503', () => {
    expect(isRetryableStatus(429)).toBe(true)
    expect(isRetryableStatus(503)).toBe(true)
    for (const s of [200, 400, 401, 403, 404, 409, 500, 502, 504]) {
      expect(isRetryableStatus(s)).toBe(false)
    }
  })

  it('does not retry 500/502 — those are usually deterministic partner bugs', () => {
    // Retrying them turns one failing call into N, with no better outcome.
    expect(isRetryableStatus(500)).toBe(false)
    expect(isRetryableStatus(502)).toBe(false)
  })
})

describe('isIdempotent', () => {
  it('treats GET/HEAD/OPTIONS as safe', () => {
    expect(isIdempotent('GET', undefined)).toBe(true)
    expect(isIdempotent('HEAD', undefined)).toBe(true)
    expect(isIdempotent('OPTIONS', undefined)).toBe(true)
  })

  it('treats POST/PUT/PATCH/DELETE as unsafe by default', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isIdempotent(m, undefined)).toBe(false)
    }
  })

  it('honors an explicit mutating=false on an otherwise-unsafe method', () => {
    // Partners overload POST for reads (Atlas does this for report generation);
    // the caller can assert it is safe.
    expect(isIdempotent('POST', false)).toBe(true)
  })

  it('honors an explicit mutating=true on an otherwise-safe method', () => {
    // A GET that mutates is bad design, but if the caller says so, believe them.
    expect(isIdempotent('GET', true)).toBe(false)
  })
})

describe('retryDelayMs', () => {
  it('prefers Retry-After over backoff', () => {
    expect(retryDelayMs('2', 0, NOW)).toBe(2000)
  })

  it('falls back to exponential backoff when Retry-After is absent', () => {
    expect(retryDelayMs(null, 0, NOW)).toBe(backoffMs(0))
    expect(retryDelayMs(null, 1, NOW)).toBe(backoffMs(1))
    expect(backoffMs(1)).toBeGreaterThan(backoffMs(0))
  })

  it('caps backoff', () => {
    expect(backoffMs(50)).toBeLessThanOrEqual(MAX_RETRY_AFTER_MS)
  })
})

describe('clamps', () => {
  it('clamps max retries into [0, 5] and defaults to 2', () => {
    expect(clampMaxRetries(undefined)).toBe(2)
    expect(clampMaxRetries('0')).toBe(0)
    expect(clampMaxRetries('99')).toBe(5)
    expect(clampMaxRetries('-1')).toBe(0)
    expect(clampMaxRetries('nonsense')).toBe(2)
  })

  it('clamps the timeout into [1000, 60000] and defaults to 30s', () => {
    expect(clampTimeoutMs(undefined)).toBe(DEFAULT_TIMEOUT_MS)
    expect(clampTimeoutMs('5000')).toBe(5000)
    expect(clampTimeoutMs('1')).toBe(1000)
    expect(clampTimeoutMs('999999')).toBe(60_000)
    expect(clampTimeoutMs('nope')).toBe(DEFAULT_TIMEOUT_MS)
  })
})
