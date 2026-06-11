/**
 * CLI entry point for the dev seed — `npm run db:seed` runs `tsx prisma/seed-run.ts`.
 *
 * Kept separate from seed.ts so tests can import `main(db)` without the
 * import itself constructing a PrismaClient or requiring DATABASE_URL.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { main } from './seed'

const connectionString = process.env['DATABASE_URL']
if (!connectionString) throw new Error('DATABASE_URL environment variable is not set')
const adapter = new PrismaPg({ connectionString })
const db = new PrismaClient({ adapter })

main(db)
  .catch((err: unknown) => {
    console.error('Seed failed:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void db.$disconnect()
  })
