import 'dotenv/config'
import { defineConfig } from 'prisma/config'

const pickEnv = (names: readonly string[]): string | undefined => {
  for (const name of names) {
    const value = process.env[name]
    if (value !== undefined && value !== '') return value
  }
  return undefined
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // CLI operations (migrate, db pull, studio). Prefer DIRECT_URL so
    // `prisma migrate deploy` bypasses Neon's PgBouncer pooler — pooled
    // (transaction-mode) connections don't support advisory locks or the
    // multi-statement transactions migrations rely on. Falls back to
    // DATABASE_URL for local dev (single Postgres, no pooler) and to a
    // placeholder so `prisma generate` works in CI without any env set.
    // The Lambda runtime never reads this file; it consumes DATABASE_URL
    // directly via the adapter in src/db.ts.
    //
    // Treat empty strings as missing — GitHub Actions interpolates absent
    // secrets as `''`, which would otherwise satisfy `??` and pass an
    // empty url to Prisma ("Connection url is empty.").
    url:
      pickEnv(['DIRECT_URL', 'DATABASE_URL']) ??
      'postgresql://placeholder:placeholder@localhost:5432/placeholder',
  },
})
