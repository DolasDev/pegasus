// ---------------------------------------------------------------------------
// Inbound opt-out / opt-in keywords → SmsOptOut state.
//
// Called by the RingCentral sync for EVERY captured inbound message, in every
// sync mode (incremental, full and backfill). This is deliberately independent
// of `sms.received`, which fires on incremental syncs only; a STOP that arrives
// through a backfill must still stop us texting.
//
// The state is ordered by the message's own RingCentral time, so re-capture is a
// no-op and an old STOP replayed by a backfill cannot undo a later START.
// Non-fatal by contract: the caller logs and continues, because a failure here
// must never abort message capture.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import { classifySmsKeyword, type Message } from '@pegasus/domain'
import { createSmsOptOutRepository } from '../../repositories/sms-opt-out.repository'

export async function applyInboundKeyword(
  db: PrismaClient,
  tenantId: string,
  message: Pick<Message, 'id' | 'direction' | 'fromNumber' | 'body' | 'rcCreationTime'>,
): Promise<'opted_out' | 'opted_in' | null> {
  if (message.direction !== 'INBOUND') return null
  const keyword = classifySmsKeyword(message.body)
  if (!keyword) return null

  const outcome = await createSmsOptOutRepository(db).record({
    tenantId,
    phoneE164: message.fromNumber,
    optedOut: keyword === 'OPT_OUT',
    source: 'KEYWORD',
    keyword: (message.body ?? '')
      .trim()
      .split(/\s+/, 1)[0]!
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase(),
    messageId: message.id,
    effectiveAt: message.rcCreationTime,
  })
  if (outcome === 'stale') return null
  return keyword === 'OPT_OUT' ? 'opted_out' : 'opted_in'
}
