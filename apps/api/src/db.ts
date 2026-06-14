import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// ---------------------------------------------------------------------------
// Prisma client singleton (lazy)
//
// The client is created on first *use*, not on import. This keeps `import
// { db } from './db'` side-effect-free with respect to DATABASE_URL: code
// paths and tests that never touch the database don't need it set. DB-dependent
// tests still guard themselves with `describe.skipIf(!process.env['DATABASE_URL'])`.
//
// In production, one PrismaClient instance is created per Lambda cold start.
// In development/test, the instance is reused across hot reloads via
// `globalThis`, preventing "too many clients" warnings.
//
// Prisma 7 requires an explicit driver adapter. PrismaPg handles connection
// pooling internally; the pool settings come from the underlying pg driver.
// ---------------------------------------------------------------------------

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

function createPrismaClient(): PrismaClient {
  const connectionString = process.env['DATABASE_URL']
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  // Phase 2 latency hardening (plans/.../api-p99-latency-remediation.md): bound
  // the Neon downstream so a hung DB call fails with a typed error well before
  // the 29s API Lambda wall (the Jun-1 timeout). Conservative, data-free-safe
  // values — both sit below the wall but above any query/connect that currently
  // succeeds, so legitimate traffic (incl. Neon serverless cold-resume) is
  // unaffected. Tighten only with real spike data + staging validation.
  //   - statement_timeout: Postgres cancels a query server-side at 25s.
  //   - connectionTimeoutMillis: cap pool connection acquisition at 20s — long
  //     enough for a Neon autosuspend resume, short enough to fail before 29s.
  const adapter = new PrismaPg({
    connectionString,
    statement_timeout: 25_000,
    connectionTimeoutMillis: 20_000,
  })
  return new PrismaClient({
    adapter,
    log: process.env['NODE_ENV'] === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  })
}

function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient()
  }
  return globalForPrisma.prisma
}

// Lazy proxy: every access resolves the real client on demand. Functions are
// bound to the real client so `this` stays correct for `$transaction`,
// `$extends`, `$disconnect`, etc.
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrismaClient()
    const value = Reflect.get(client, prop, client) as unknown
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value
  },
  has(_target, prop) {
    return Reflect.has(getPrismaClient(), prop)
  },
})
