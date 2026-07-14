// ---------------------------------------------------------------------------
// Standalone Node.js HTTP entry point
//
// Runs the cloud Hono app (app.ts) under @hono/node-server for local
// development and the e2e suite's `webServer` (apps/e2e/playwright.config.ts).
// The Lambda entry point (lambda.ts) remains the AWS deployment path.
//
// Environment variables:
//   PORT      — HTTP port (default: 3000)
//   HOST      — Bind address (default: 0.0.0.0)
//   SKIP_AUTH — When "true", bypasses Cognito auth (local / internal use)
// ---------------------------------------------------------------------------

// Load .env before any module reads process.env.
import 'dotenv/config'

import { serve } from '@hono/node-server'
import { app } from './app'
import { logger } from './lib/logger'
import { validateEnv } from './lib/env'
import { db } from './db'

/**
 * Starts the HTTP server. Returns the server instance.
 */
export function startServer() {
  validateEnv()

  const port = parseInt(process.env['PORT'] ?? '3000', 10)
  const hostname = process.env['HOST'] ?? '0.0.0.0'

  const server = serve({ fetch: app.fetch, port, hostname }, () => {
    logger.info(`Server listening on ${hostname}:${port}`)
  })

  return server
}

/**
 * Graceful shutdown — disconnects Prisma.
 */
export async function shutdown(): Promise<void> {
  logger.info('Shutting down gracefully...')
  await db.$disconnect()
  logger.info('Shutdown complete')
}

// ---------------------------------------------------------------------------
// Auto-start when run directly (not imported as a module by tests)
// ---------------------------------------------------------------------------
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('/server.ts') ||
    process.argv[1].endsWith('/server.js') ||
    process.argv[1].endsWith('\\server.ts') ||
    process.argv[1].endsWith('\\server.js'))

if (isDirectRun) {
  const server = startServer()

  const onSignal = async () => {
    await shutdown()
    if (server && typeof (server as { close?: (cb: () => void) => void }).close === 'function') {
      ;(server as { close: (cb: () => void) => void }).close(() => process.exit(0))
    } else {
      process.exit(0)
    }
  }

  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
}
