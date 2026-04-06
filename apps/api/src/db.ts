import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// ---------------------------------------------------------------------------
// Prisma client singleton
//
// In production, one PrismaClient instance is created per Lambda cold start.
// In development/test, we re-use the same instance across hot reloads by
// attaching it to `globalThis`, preventing "too many clients" warnings.
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
  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({
    adapter,
    log: process.env['NODE_ENV'] === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  })
}

export const db: PrismaClient = globalForPrisma.prisma ?? createPrismaClient()

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = db
}
