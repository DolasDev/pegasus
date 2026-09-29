// ---------------------------------------------------------------------------
// SmsOptOut repository — per-tenant opt-out state for one phone number.
//
// Writes are ordered by `effectiveAt`, the instant of the event that set the
// state (a keyword's own RingCentral time), not by when we happened to process
// it. A write applies only if it is newer than what is stored, so replaying an
// old STOP during a backfill cannot undo a START the customer sent later, and
// re-capturing the same message is a no-op.
//
// Every query names tenantId explicitly: the RingCentral sync job calls this on
// the root (cross-tenant) client, where the tenant extension does not apply.
// ---------------------------------------------------------------------------

import { Prisma, type PrismaClient, type SmsOptOutSource } from '@prisma/client'

export type SmsOptOutRow = {
  phoneE164: string
  optedOut: boolean
  source: SmsOptOutSource
  keyword: string | null
  messageId: string | null
  effectiveAt: Date
  updatedAt: Date
}

const SELECT = {
  phoneE164: true,
  optedOut: true,
  source: true,
  keyword: true,
  messageId: true,
  effectiveAt: true,
  updatedAt: true,
} as const

export type RecordOptOutInput = {
  tenantId: string
  phoneE164: string
  optedOut: boolean
  source: SmsOptOutSource
  effectiveAt: Date
  keyword?: string
  messageId?: string
}

/** `stale` means a newer event already set this number's state; nothing changed. */
export type RecordOutcome = 'created' | 'updated' | 'stale'

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export function createSmsOptOutRepository(db: PrismaClient) {
  return {
    async find(tenantId: string, phoneE164: string): Promise<SmsOptOutRow | null> {
      return db.smsOptOut.findFirst({ where: { tenantId, phoneE164 }, select: SELECT })
    },

    /** True when the number has opted out of texts from this tenant. */
    async isOptedOut(tenantId: string, phoneE164: string): Promise<boolean> {
      const row = await db.smsOptOut.findFirst({
        where: { tenantId, phoneE164 },
        select: { optedOut: true },
      })
      return row?.optedOut ?? false
    },

    async record(input: RecordOptOutInput): Promise<RecordOutcome> {
      const data = {
        optedOut: input.optedOut,
        source: input.source,
        keyword: input.keyword ?? null,
        messageId: input.messageId ?? null,
        effectiveAt: input.effectiveAt,
      }
      const applyIfNewer = () =>
        db.smsOptOut.updateMany({
          where: {
            tenantId: input.tenantId,
            phoneE164: input.phoneE164,
            effectiveAt: { lt: input.effectiveAt },
          },
          data,
        })

      const { count } = await applyIfNewer()
      if (count > 0) return 'updated'
      try {
        await db.smsOptOut.create({
          data: { tenantId: input.tenantId, phoneE164: input.phoneE164, ...data },
        })
        return 'created'
      } catch (err) {
        if (!isUniqueViolation(err)) throw err
        // A concurrent writer created the row first; ours still wins if newer.
        const retried = await applyIfNewer()
        return retried.count > 0 ? 'updated' : 'stale'
      }
    },
  }
}
