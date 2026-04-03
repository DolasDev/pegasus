/**
 * Vitest global setup — manages a local Postgres container for integration tests.
 *
 * Behaviour:
 *   1. If DATABASE_URL is already set (Neon, CI secret, manual override) →
 *      respect it and skip all Docker logic.
 *   2. If localhost:5432 is already reachable → reuse the running instance.
 *   3. Otherwise → `docker compose up -d postgres` from the repo root, then
 *      wait for the port to open.
 *
 * The container is intentionally left running after the suite so subsequent
 * runs skip the startup cost. Stop it manually: `docker compose down`.
 *
 * No teardown is exported — Vitest calls teardown if this function returns one;
 * returning nothing means the container stays up.
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

// packages/api/ — where prisma/ lives and where the Prisma CLI expects to run.
const API_DIR = path.resolve(__dirname)
// Repo root — where docker-compose.yml lives.
const ROOT_DIR = path.resolve(__dirname, '../..')

const DOCKER_DB_URL = 'postgresql://pegasus:pegasus@localhost:5432/pegasus'

/** Attempts a TCP connection; resolves true if the port is open within timeoutMs. */
function canReach(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.once('timeout', () => done(false))
  })
}

/** Polls until Postgres accepts TCP connections or the attempt limit is reached. */
async function waitForPostgres(attempts = 30, intervalMs = 500): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await canReach('localhost', 5432)) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error('[test:db] Postgres did not become reachable in time.')
}

/** Loads key=value pairs from a .env file into process.env (does not override existing vars). */
function loadDotEnv(filePath: string): void {
  if (!existsSync(filePath)) return
  const lines = readFileSync(filePath, 'utf8').split('\n')
  for (const line of lines) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"]*)"?\s*$/)
    if (match && match[1] && match[2] && !process.env[match[1]]) {
      process.env[match[1]] = match[2]
    }
  }
}

export async function setup(): Promise<void> {
  // ── 0. Load .env so DATABASE_URL / DIRECT_URL are available ───────────────
  loadDotEnv(path.join(API_DIR, '.env'))

  // ── 1. Honour an externally-provided DATABASE_URL ─────────────────────────
  if (process.env['DATABASE_URL']) {
    console.log('\n[test:db] DATABASE_URL already set — skipping Docker setup\n')
    return
  }

  // ── 2. Check whether Postgres is already listening ────────────────────────
  const alreadyUp = await canReach('localhost', 5432)

  if (!alreadyUp) {
    // Verify Docker is available before trying to start anything.
    try {
      execSync('docker info', { stdio: 'pipe' })
    } catch {
      // Docker is unavailable — warn and continue. Integration tests that
      // require a DB guard themselves with `describe.skipIf(!process.env['DATABASE_URL'])`.
      console.warn(
        '\n[test:db] Postgres is not running and Docker is not available.' +
          ' DB-dependent tests will be skipped. Set DATABASE_URL or start Docker to run them.\n',
      )
      return
    }

    console.log('\n[test:db] Starting postgres container...')
    execSync('docker compose up -d postgres', { cwd: ROOT_DIR, stdio: 'inherit' })
    await waitForPostgres()
    console.log('[test:db] Postgres is ready.\n')
  } else {
    console.log('\n[test:db] Postgres already running — reusing.\n')
  }

  // ── 3. Expose connection strings to all test workers (inherited on fork) ───
  process.env['DATABASE_URL'] = DOCKER_DB_URL
  process.env['DIRECT_URL'] = DOCKER_DB_URL

  // ── 4. Apply any pending migrations (no-op if schema is already current) ──
  console.log('[test:db] Applying migrations...')
  try {
    execSync('node ../../node_modules/.bin/prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env },
      stdio: 'pipe',
    })
    console.log('[test:db] Migrations applied.\n')
  } catch (err) {
    const stderr = (err as NodeJS.ErrnoException & { stderr?: Buffer }).stderr?.toString() ?? ''
    console.error('[test:db] Migration failed:\n', stderr || String(err))
    throw err
  }
}
