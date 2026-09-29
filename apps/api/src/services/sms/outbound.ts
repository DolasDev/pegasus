// ---------------------------------------------------------------------------
// Outbound SMS — the one path every platform text goes through.
//
// Both callers (POST /sms/send and the feedback-request SMS sugar path) send
// here, so two policies hold for every text the platform sends:
//
//   1. Opt-out. A number that texted STOP (or that RingCentral refused as opted
//      out) is never texted again by this tenant. Checked immediately before
//      the provider call; a provider SMS-*-413 is recorded and reported the
//      same way.
//   2. Idempotency. With a `dedupKey`, the first call claims an SmsSend row and
//      a retry with the same key returns that send (`alreadySent: true`)
//      instead of texting the customer twice. A key still PENDING is reported,
//      never blindly re-sent: a crash between the provider call and markSent
//      would otherwise double-text.
//
// Returns an outcome union; provider failures (RateLimitError /
// RingCentralOAuthError) are rethrown after the claim is marked FAILED so the
// HTTP layer keeps its existing 429/502 mapping and a retry can reclaim.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { readOAuthConfig, RingCentralOAuthError } from '../ringcentral/oauth'
import { sendSms } from '../ringcentral/sms'
import { listConnectionsByTenant } from '../../repositories/messaging.repository'
import { createSmsOptOutRepository } from '../../repositories/sms-opt-out.repository'
import { createSmsSendRepository } from '../../repositories/sms-send.repository'
import { logger } from '../../lib/logger'

/** RingCentral's "destination subscriber opted out", from RC itself, upstream or the carrier. */
const PROVIDER_OPT_OUT_CODE = /^SMS-(RC|UP|CAR)-413$/

/** A PENDING claim younger than this is assumed to still be in flight. */
export const IN_FLIGHT_WINDOW_MS = 2 * 60 * 1000

export type OutboundSmsResult =
  /**
   * `id` is RingCentral's message id exactly as it returned it (a number today);
   * a replayed send returns the id stored with the first send, as a string.
   */
  | { kind: 'sent'; id: string | number | null; status: string | null; alreadySent: boolean }
  | { kind: 'disabled' }
  | { kind: 'no_connection' }
  | { kind: 'opted_out' }
  /** Same dedup key, still PENDING and recent — another attempt is mid-send. */
  | { kind: 'in_progress' }
  /** Same dedup key, PENDING and stale — the outcome is unknown; do not resend blindly. */
  | { kind: 'in_doubt' }
  /** Same dedup key reused for a different recipient or body. */
  | { kind: 'key_reused' }

export async function sendTenantSms(
  db: PrismaClient,
  tenantId: string,
  input: { to: string; body: string; dedupKey?: string },
  now: () => Date = () => new Date(),
): Promise<OutboundSmsResult> {
  if (!readOAuthConfig()) return { kind: 'disabled' }

  const sends = createSmsSendRepository(db)
  let claimId: string | undefined
  if (input.dedupKey !== undefined) {
    const bodyHash = createHash('sha256').update(input.body).digest('hex')
    const claim = await sends.claim({
      tenantId,
      dedupKey: input.dedupKey,
      toNumber: input.to,
      bodyHash,
    })
    const row = claim.row
    if (claim.outcome === 'exists') {
      if (row.toNumber !== input.to || row.bodyHash !== bodyHash) return { kind: 'key_reused' }
      if (row.status === 'SENT') {
        return {
          kind: 'sent',
          id: row.providerMessageId,
          status: row.providerStatus,
          alreadySent: true,
        }
      }
      if (row.status === 'PENDING') {
        const age = now().getTime() - row.updatedAt.getTime()
        return age < IN_FLIGHT_WINDOW_MS ? { kind: 'in_progress' } : { kind: 'in_doubt' }
      }
      // FAILED: exactly one retry may take it back.
      if (!(await sends.reclaimFailed(tenantId, row.id))) return { kind: 'in_progress' }
    }
    claimId = row.id
  }

  const fail = async (reason: string) => {
    if (claimId) await sends.markFailed(tenantId, claimId, reason)
  }

  const optOuts = createSmsOptOutRepository(db)
  if (await optOuts.isOptedOut(tenantId, input.to)) {
    await fail('recipient has opted out')
    return { kind: 'opted_out' }
  }

  const connections = await listConnectionsByTenant(db, tenantId)
  const connection = connections.find(
    (conn) => conn.tokenStatus === 'ACTIVE' && conn.tokenSecretArn != null,
  )
  if (!connection) {
    await fail('no active RingCentral connection')
    return { kind: 'no_connection' }
  }

  try {
    const result = await sendSms(connection, input.to, input.body)
    const status = result.messageStatus ?? null
    if (claimId) {
      await sends.markSent(tenantId, claimId, {
        messageId: result.id != null ? String(result.id) : null,
        status,
      })
    }
    return { kind: 'sent', id: result.id ?? null, status, alreadySent: false }
  } catch (err) {
    await fail(err instanceof Error ? err.message : String(err))
    if (err instanceof RingCentralOAuthError && PROVIDER_OPT_OUT_CODE.test(err.errorCode ?? '')) {
      await optOuts.record({
        tenantId,
        phoneE164: input.to,
        optedOut: true,
        source: 'PROVIDER',
        effectiveAt: now(),
      })
      logger.info('SMS recipient opted out at the provider', { tenantId, code: err.errorCode })
      return { kind: 'opted_out' }
    }
    throw err
  }
}
