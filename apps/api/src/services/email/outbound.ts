// ---------------------------------------------------------------------------
// Outbound email — the one path every platform email takes.
//
// Delivered through the tenant's pegII API (its SMTP account), because the
// platform's own SES account has no production access. Before anything is
// sent, four policies hold:
//
//   1. Internal only (plan decision D2). Every `to`/`cc` domain must be on the
//      tenant's `operations.emailAllowedRecipientDomains` app setting, which
//      only tenant admins can change. No list ⇒ email is not configured.
//   2. Caps: ≤ 10 recipients, ≤ 100 KB body.
//   3. A per-tenant daily limit, so a runaway workflow can't flood a mailbox.
//   4. Idempotency with a dedup key, exactly like send_sms: a retry with the
//      same key returns the first send (alreadySent) instead of mailing again;
//      a PENDING key is reported (in progress / in doubt), never blindly resent.
//
// Every send — keyed or not — gets an EmailSend row (audit + limit counter).
// Gateway failures (PegiiApiError) are rethrown after the row is marked FAILED
// so the HTTP layer maps them and a retry can reclaim.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { createEmailSendRepository } from '../../repositories/email-send.repository'
import { getAppSettings } from '../../lib/app-settings'
import type { EmailGateway, PegiiEmail } from '../../gateways/pegii-email.gateway'

export const MAX_RECIPIENTS = 10
export const MAX_BODY_BYTES = 100 * 1024
export const DAILY_EMAIL_LIMIT = 500
/** A PENDING claim younger than this is assumed to still be in flight. */
export const IN_FLIGHT_WINDOW_MS = 2 * 60 * 1000

export type OutboundEmailInput = PegiiEmail & { dedupKey?: string }

export type OutboundEmailResult =
  | { kind: 'sent'; id: string; alreadySent: boolean }
  | { kind: 'not_configured' }
  | { kind: 'recipient_not_allowed'; recipients: string[] }
  | { kind: 'too_many_recipients' }
  | { kind: 'body_too_large' }
  | { kind: 'daily_limit' }
  | { kind: 'in_progress' }
  | { kind: 'in_doubt' }
  | { kind: 'key_reused' }

const domainOf = (address: string) => address.slice(address.lastIndexOf('@') + 1).toLowerCase()

export async function sendTenantEmail(
  db: PrismaClient,
  tenantId: string,
  input: OutboundEmailInput,
  resolveGateway: () => Promise<EmailGateway>,
  now: () => Date = () => new Date(),
): Promise<OutboundEmailResult> {
  const recipients = [...input.to, ...input.cc]
  if (recipients.length > MAX_RECIPIENTS) return { kind: 'too_many_recipients' }
  if (Buffer.byteLength(input.body, 'utf8') > MAX_BODY_BYTES) return { kind: 'body_too_large' }

  const allowed = new Set(
    ((await getAppSettings(db, tenantId)).operations.emailAllowedRecipientDomains ?? []).map((d) =>
      d.toLowerCase(),
    ),
  )
  if (allowed.size === 0) return { kind: 'not_configured' }
  const disallowed = recipients.filter((r) => !allowed.has(domainOf(r)))
  if (disallowed.length > 0) return { kind: 'recipient_not_allowed', recipients: disallowed }

  const sends = createEmailSendRepository(db)
  const requestHash = createHash('sha256')
    .update(JSON.stringify([input.to, input.cc, input.subject, input.bodyType, input.body]))
    .digest('hex')
  const claim = await sends.claim({
    tenantId,
    dedupKey: input.dedupKey ?? null,
    toAddresses: input.to,
    ccAddresses: input.cc,
    subject: input.subject,
    requestHash,
  })
  const row = claim.row
  if (claim.outcome === 'exists') {
    if (row.requestHash !== requestHash) return { kind: 'key_reused' }
    if (row.status === 'SENT') return { kind: 'sent', id: row.id, alreadySent: true }
    if (row.status === 'PENDING') {
      const age = now().getTime() - row.updatedAt.getTime()
      return age < IN_FLIGHT_WINDOW_MS ? { kind: 'in_progress' } : { kind: 'in_doubt' }
    }
    if (!(await sends.reclaimFailed(tenantId, row.id))) return { kind: 'in_progress' }
  }

  // Counted after the claim so this send is included; over the limit, release it.
  const since = new Date(now().getTime() - 24 * 60 * 60 * 1000)
  if ((await sends.countAttemptedSince(tenantId, since)) > DAILY_EMAIL_LIMIT) {
    await sends.markFailed(tenantId, row.id, 'daily email limit reached')
    return { kind: 'daily_limit' }
  }

  try {
    const gateway = await resolveGateway()
    await gateway.send({
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      body: input.body,
      bodyType: input.bodyType,
    })
  } catch (err) {
    await sends.markFailed(tenantId, row.id, err instanceof Error ? err.message : String(err))
    throw err
  }
  await sends.markSent(tenantId, row.id)
  return { kind: 'sent', id: row.id, alreadySent: false }
}
