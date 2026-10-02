// ---------------------------------------------------------------------------
// EmailSend repository — one row per platform email: the audit trail, the
// per-tenant daily-limit counter, and (with a dedup key) the idempotency claim.
//
// Same conditional-write primitives as SmsSend / WorkflowState: the unique
// (tenantId, dedupKey) index is the claim, and a FAILED row is reclaimed by a
// status compare-and-set. Rows without a dedup key never collide (Postgres
// treats NULLs as distinct in a unique index). See "Conditional writes on
// Postgres" in dolas/agents/project/PATTERNS.md.
// ---------------------------------------------------------------------------

import { Prisma, type PrismaClient, type EmailSendStatus } from '@prisma/client'

export type EmailSendRow = {
  id: string
  dedupKey: string | null
  requestHash: string
  status: EmailSendStatus
  updatedAt: Date
}

const SELECT = {
  id: true,
  dedupKey: true,
  requestHash: true,
  status: true,
  updatedAt: true,
} as const

export type ClaimEmailResult =
  { outcome: 'claimed'; row: EmailSendRow } | { outcome: 'exists'; row: EmailSendRow }

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export function createEmailSendRepository(db: PrismaClient) {
  return {
    /** Insert a PENDING record; with a dedup key, return the existing one on collision. */
    async claim(input: {
      tenantId: string
      dedupKey: string | null
      toAddresses: string[]
      ccAddresses: string[]
      subject: string
      requestHash: string
    }): Promise<ClaimEmailResult> {
      try {
        const row = await db.emailSend.create({
          data: { ...input, status: 'PENDING' },
          select: SELECT,
        })
        return { outcome: 'claimed', row }
      } catch (err) {
        if (!isUniqueViolation(err) || input.dedupKey === null) throw err
        const row = await db.emailSend.findFirst({
          where: { tenantId: input.tenantId, dedupKey: input.dedupKey },
          select: SELECT,
        })
        if (!row) throw err
        return { outcome: 'exists', row }
      }
    },

    /** Move a FAILED record back to PENDING. True only for the one caller that won. */
    async reclaimFailed(tenantId: string, id: string): Promise<boolean> {
      const { count } = await db.emailSend.updateMany({
        where: { tenantId, id, status: 'FAILED' },
        data: { status: 'PENDING', lastError: null },
      })
      return count === 1
    },

    async markSent(tenantId: string, id: string): Promise<void> {
      await db.emailSend.updateMany({
        where: { tenantId, id },
        data: { status: 'SENT', lastError: null },
      })
    },

    async markFailed(tenantId: string, id: string, error: string): Promise<void> {
      await db.emailSend.updateMany({
        where: { tenantId, id },
        data: { status: 'FAILED', lastError: error.slice(0, 500) },
      })
    },

    /** Sends that were attempted (not FAILED) since `since` — the daily-limit counter. */
    async countAttemptedSince(tenantId: string, since: Date): Promise<number> {
      return db.emailSend.count({
        where: { tenantId, createdAt: { gte: since }, status: { not: 'FAILED' } },
      })
    },
  }
}
