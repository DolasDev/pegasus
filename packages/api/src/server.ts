// ---------------------------------------------------------------------------
// Standalone Node.js HTTP entry point
//
// Runs the Hono app using @hono/node-server for on-premises deployment.
// The Lambda entry point (lambda.ts) remains unchanged for AWS deployment.
//
// Environment variables:
//   PORT      — HTTP port (default: 3000)
//   HOST      — Bind address (default: 0.0.0.0)
//   SKIP_AUTH — When "true", bypasses Cognito auth (on-prem / internal use)
// ---------------------------------------------------------------------------

import { serve } from '@hono/node-server'
import { app } from './app'
import { logger } from './lib/logger'
import { closeAllPools } from './lib/mssql'
import { db } from './db'

/**
 * Starts the HTTP server. Returns the server instance.
 */
export function startServer() {
  const port = parseInt(process.env['PORT'] ?? '3000', 10)
  const hostname = process.env['HOST'] ?? '0.0.0.0'

  const server = serve({ fetch: app.fetch, port, hostname }, () => {
    logger.info(`Server listening on ${hostname}:${port}`)
  })

  return server
}

/**
 * Graceful shutdown — closes MSSQL connection pools and disconnects Prisma.
 */
export async function shutdown(): Promise<void> {
  logger.info('Shutting down gracefully...')
  await closeAllPools()
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
