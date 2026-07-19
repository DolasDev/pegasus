/**
 * Regression guard (no DB required) for the prod incident where a full 400NG
 * import (~6k rows over Neon, ~8s) blew Prisma's default 5s interactive-
 * transaction timeout and 500'd. importTariff400ng must pass an explicit,
 * generous `timeout` to $transaction. This mocks the client so it asserts the
 * option directly, independent of DB speed (the real integration test in
 * tariff.repository.test.ts runs against fast local Postgres and would never
 * reproduce the timeout).
 */
import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { Tariff400ngImport } from '../../rating/import-schema'
import { importTariff400ng } from '../tariff.repository'

function minimalDoc(): Tariff400ngImport {
  return {
    schemaVersion: 1,
    tariffCode: '400NG',
    label: 'tx-timeout fixture',
    effectiveFrom: '2020-01-01T00:00:00.000Z',
    effectiveTo: '2020-06-01T00:00:00.000Z',
    zip3s: [{ zip3: '001', serviceArea: 'TST' }],
    serviceAreas: [
      {
        serviceArea: 'TST',
        schedule: 1,
        serviceChargeCentsPerCwt: 100,
        linehaulFactorCentsPerCwt: 50,
      },
    ],
    linehaulRates: [
      { milesLower: 0, milesUpper: 100, weightLower: 0, weightUpper: 1000, rateCents: 123 },
    ],
    shorthaulRates: [{ cwtMilesLower: 0, cwtMilesUpper: 100, rateCents: 45 }],
    packRates: [],
    unpackRates: [],
  }
}

/** A fake transaction client — every write is a no-op resolving to a stub row. */
function fakeTx() {
  const noop = {
    create: vi.fn().mockResolvedValue({ id: 'tv-1', status: 'STAGED' }),
    createMany: vi.fn(),
  }
  return {
    tariffVersion: { create: noop.create },
    tariff400ngZip3: { createMany: vi.fn() },
    tariff400ngServiceArea: { createMany: vi.fn() },
    tariff400ngLinehaulRate: { createMany: vi.fn() },
    tariff400ngShorthaulRate: { createMany: vi.fn() },
    tariff400ngFullPackRate: { createMany: vi.fn() },
    tariff400ngFullUnpackRate: { createMany: vi.fn() },
  }
}

describe('importTariff400ng transaction timeout', () => {
  it('passes a generous timeout (>= 20s) to $transaction so a full import survives Neon latency', async () => {
    let capturedOptions: { timeout?: number; maxWait?: number } | undefined
    const tx = fakeTx()

    const db = {
      tariffVersion: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown, options?: unknown) => {
        capturedOptions = options as typeof capturedOptions
        return cb(tx)
      }),
    } as unknown as PrismaClient

    const result = await importTariff400ng(db, minimalDoc())

    expect(result.created).toBe(true)
    expect(capturedOptions).toBeDefined()
    // The default is 5s; anything under ~20s risks the prod timeout on a real import.
    expect(capturedOptions?.timeout ?? 5_000).toBeGreaterThanOrEqual(20_000)
    // ...but must stay under the 29s API Lambda / API Gateway ceiling.
    expect(capturedOptions?.timeout ?? 5_000).toBeLessThan(29_000)
  })
})
