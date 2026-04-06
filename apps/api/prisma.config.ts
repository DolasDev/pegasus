import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Allow prisma generate to run without DATABASE_URL set (e.g. CI, local dev).
    // At runtime the adapter in db.ts provides the connection.
    url:
      process.env['DATABASE_URL'] ??
      'postgresql://placeholder:placeholder@localhost:5432/placeholder',
  },
})
