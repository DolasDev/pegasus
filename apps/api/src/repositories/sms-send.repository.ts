// ---------------------------------------------------------------------------
// SmsSend repository — idempotency records for outbound SMS sent with a
// caller-supplied dedup key.
//
// The unique (tenantId, dedupKey) index is the claim: the first send inserts a
// PENDING row, and a retry with the same key finds it instead of texting the
// customer twice. A FAILED row may be reclaimed by exactly one retry
// (compare-and-set on status). Same primitives as the workflow-state store —
// see "Conditional writes on Postgres" in dolas/agents/project/PATTERNS.md.
// ---------------------------------------------------------------------------

import { Prisma, type PrismaClient, type SmsSendStatus } from '@prisma/client'

export type SmsSendRow = {
  id: string
  dedupKey: string
  toNumber: string
  bodyHash: string
  status: SmsSendStatus
  providerMessageId: string | null
  providerStatus: string | null
  lastError: string | null
  createdAt: Date
  updatedAt: Date
}

const SELECT = {
  id: true,
  dedupKey: true,
  toNumber: true,
  bodyHash: true,
  status: true,
  providerMessageId: true,
  providerStatus: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
} as const

export type ClaimSendResult =
  { outcome: 'claimed'; row: SmsSendRow } | { outcome: 'exists'; row: SmsSendRow }

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export function createSmsSendRepository(db: PrismaClient) {
  return {
    /** Insert a PENDING record for this key, or return the one already there. */
    async claim(input: {
      tenantId: string
      dedupKey: string
      toNumber: string
      bodyHash: string
    }): Promise<ClaimSendResult> {
      try {
        const row = await db.smsSend.create({
          data: { ...input, status: 'PENDING' },
          select: SELECT,
        })
        return { outcome: 'claimed', row }
      } catch (err) {
        if (!isUniqueViolation(err)) throw err
        const row = await db.smsSend.findFirst({
          where: { tenantId: input.tenantId, dedupKey: input.dedupKey },
          select: SELECT,
        })
        if (!row) throw err
        return { outcome: 'exists', row }
      }
    },

    /** Move a FAILED record back to PENDING. True only for the one caller that won. */
    async reclaimFailed(tenantId: string, id: string): Promise<boolean> {
      const { count } = await db.smsSend.updateMany({
        where: { tenantId, id, status: 'FAILED' },
        data: { status: 'PENDING', lastError: null },
      })
      return count === 1
    },

    async markSent(
      tenantId: string,
      id: string,
      provider: { messageId: string | null; status: string | null },
    ): Promise<void> {
      await db.smsSend.updateMany({
        where: { tenantId, id },
        data: {
          status: 'SENT',
          providerMessageId: provider.messageId,
          providerStatus: provider.status,
          lastError: null,
        },
      })
    },

    async markFailed(tenantId: string, id: string, error: string): Promise<void> {
      await db.smsSend.updateMany({
        where: { tenantId, id },
        data: { status: 'FAILED', lastError: error.slice(0, 500) },
      })
    },
  }
}
