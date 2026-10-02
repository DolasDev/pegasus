// ---------------------------------------------------------------------------
// Usage repository — the billable-action meter's store (UsageEvent).
//
// The unique (tenantId, action, subjectKey) index is the meter's own dedup:
// the same subject recorded twice is one action. `createMany` with
// `skipDuplicates` makes a duplicate a silent no-op instead of a P2002 — never
// call this inside an interactive transaction regardless (a unique violation
// aborts the whole Postgres transaction; the #730 lesson).
//
// UsageEvent is in TENANT_SCOPED_MODELS, but the extension does NOT rewrite
// creates, so `tenantId` is always set explicitly.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'

export interface RecordUsageInput {
  tenantId: string
  action: string
  subjectKey: string
  apiClientId: string
  workflowId: string | null
  correlationId: string | null
}

export function createUsageRepository(db: PrismaClient) {
  return {
    /** Record one billable action. Returns false when the subject was already counted. */
    async record(input: RecordUsageInput): Promise<boolean> {
      const { count } = await db.usageEvent.createMany({
        data: [input],
        skipDuplicates: true,
      })
      return count === 1
    },
  }
}
