// ---------------------------------------------------------------------------
// Scheduled Lambda — monthly usage-statement close.
//
// Runs daily (a rate, not a month-end cron): each run writes every fully-past
// month's statement that is still missing, so a missed day — or a missed month
// boundary — heals on the next run. Closed statements are immutable. Logic in
// lib/usage/statement-close.ts. Scheduling lives in the CDK ApiStack
// (EventBridge rule).
//
// A tenant whose close failed is logged and the run then THROWS, so the
// account-wide Lambda Errors alarm pages: an unclosed month is an unsent invoice.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import { db } from './db'
import { createLogger } from './lib/logger'
import { closeUsageStatements } from './lib/usage/statement-close'

const logger = createLogger('pegasus-usage-statement-close')

export async function handler(): Promise<void> {
  const result = await closeUsageStatements(db as unknown as PrismaClient)

  logger.info('Usage statement close complete', {
    tenantsChecked: result.tenantsChecked,
    statementsWritten: result.statementsWritten.length,
    closed: result.statementsWritten,
  })

  if (result.failures.length > 0) {
    logger.error('Usage statement close failed for some tenants', { failures: result.failures })
    throw new Error(`usage statement close failed for ${result.failures.length} tenant(s)`)
  }
}
