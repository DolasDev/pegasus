import { PrismaClient } from '@prisma/client'

// ---------------------------------------------------------------------------
// Prisma client singleton
//
// In production, one PrismaClient instance is created per Lambda cold start.
// In development/test, we re-use the same instance across hot reloads by
// attaching it to `globalThis`, preventing "too many clients" warnings.
// ---------------------------------------------------------------------------

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

export const db: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env['NODE_ENV'] === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  })

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = db
}
