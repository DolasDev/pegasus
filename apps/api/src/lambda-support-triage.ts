// ---------------------------------------------------------------------------
// Support triage worker (plan: support-channel.md, Phase 2a).
//
// Invoked asynchronously (InvocationType 'Event') by the API with
// `{ draftId }` after it writes a `pending` SupportWorkItemDraft
// (lib/support-triage-invoke.ts). Runs the one model call that fills the
// draft. Its own function because a slow model can take longer than API
// Gateway's 29 s; it shares the API's role (Bedrock grant, DB) and env.
//
// CDK sets retryAttempts 0; runTriage's claim (pending → running) also makes a
// redelivered event a no-op. The handler never throws for a bad draft: the
// draft row records the failure for the operator.
// ---------------------------------------------------------------------------

import { createLogger } from './lib/logger'
import { isSupportTriageEvent } from './lib/support-triage-invoke'
import { runTriage } from './support/triage'

const logger = createLogger('pegasus-support-triage')

export async function handler(event: unknown): Promise<{ status: string }> {
  if (!isSupportTriageEvent(event)) {
    logger.error('support_triage.bad_event', { event })
    return { status: 'bad_event' }
  }
  const status = await runTriage(event.draftId)
  return { status: status ?? 'skipped' }
}
