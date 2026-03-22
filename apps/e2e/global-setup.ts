import { execSync } from 'child_process'
import path from 'path'

const TEST_TENANT_ID = process.env['TEST_TENANT_ID'] ?? 'e2e00000-0000-0000-0000-000000000001'
const DATABASE_URL = process.env['DATABASE_URL']

/**
 * Check if Postgres is reachable by attempting a connection via psql or pg_isready.
 */
function isPostgresReachable(): boolean {
  try {
    execSync('pg_isready -h localhost -p 5432 -U pegasus', { stdio: 'ignore', timeout: 3000 })
    return true
  } catch {
    return false
  }
}

/**
 * Check if Docker is available and start the compose stack if needed.
 */
function ensureDockerPostgres(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore', timeout: 5000 })
  } catch {
    return false
  }
  // Try to start the compose stack (no-op if already running)
  try {
    const repoRoot = path.resolve(__dirname, '../..')
    execSync('docker compose up -d postgres', {
      cwd: repoRoot,
      stdio: 'ignore',
      timeout: 30000,
    })
    // Wait for Postgres to be ready
    for (let i = 0; i < 10; i++) {
      if (isPostgresReachable()) return true
      execSync('sleep 1', { stdio: 'ignore' })
    }
  } catch {
    // ignore
  }
  return false
}

export default async function globalSetup() {
  if (!DATABASE_URL) {
    console.warn('[e2e] DATABASE_URL not set — skipping E2E setup')
    process.env['E2E_SKIP'] = 'true'
    return
  }

  // Ensure Postgres is up
  if (!isPostgresReachable()) {
    console.log('[e2e] Postgres not reachable — attempting Docker start...')
    if (!ensureDockerPostgres()) {
      console.warn('[e2e] Could not reach Postgres and Docker unavailable — skipping E2E tests')
      process.env['E2E_SKIP'] = 'true'
      return
    }
  }

  // Run Prisma migrations
  try {
    const apiDir = path.resolve(__dirname, '../../packages/api')
    console.log('[e2e] Running prisma migrate deploy...')
    execSync('node ../../node_modules/.bin/prisma migrate deploy', {
      cwd: apiDir,
      env: { ...process.env },
      stdio: 'inherit',
    })
  } catch (err) {
    console.error('[e2e] prisma migrate deploy failed:', err)
    process.env['E2E_SKIP'] = 'true'
    return
  }

  // Upsert the test tenant record via raw SQL through Prisma
  try {
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL })
    await prisma.$executeRawUnsafe(
      `INSERT INTO public."Tenant" (id, name, slug, "cognitoAuthEnabled", "createdAt", "updatedAt")
       VALUES ($1, 'E2E Test Tenant', 'e2e-test', false, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      TEST_TENANT_ID,
    )
    await prisma.$disconnect()
    console.log(`[e2e] Test tenant ${TEST_TENANT_ID} ready`)
  } catch (err) {
    console.error('[e2e] Failed to upsert test tenant:', err)
    process.env['E2E_SKIP'] = 'true'
  }
}
