// ---------------------------------------------------------------------------
// Fire-and-forget kick of the workflow trigger dispatcher
// (lambda-dispatch-workflow-triggers).
//
// The dispatcher drains undispatched domain events every minute. A caller that
// just made new trigger work possible kicks it so the run starts in seconds,
// not at the next tick:
//   - 'sms_received': RingCentral capture committed a new `sms.received`;
//   - 'run_finished': a TENANT_RUNNER run ended, freeing a concurrency-cap slot
//     while its tenant has events waiting.
// Asynchronous (InvocationType 'Event'): Lambda queues the run and returns 202.
// The dispatcher has reserved concurrency 1, so a kick that lands during a
// tick is throttled and redelivered by Lambda's async retry seconds later —
// never two dispatchers counting the same free cap slots.
//
// Callers AWAIT this: on Lambda an un-awaited promise is frozen when the
// handler returns, so the invoke might never leave. KICK_TIMEOUT_MS bounds what
// that costs the caller. Mirrors push-forward-invoke.ts.
//
// TRIGGER_DISPATCHER_FUNCTION_NAME is set by CDK where the dispatcher exists
// (Temporal-configured stacks). Unset (local dev, tests) = no-op: the events
// wait for the next tick. Never throws — the work is already committed, and a
// lost kick only costs latency.
// ---------------------------------------------------------------------------

import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import { logger } from './logger'

/** How long a kick may hold its caller before giving up. */
export const KICK_TIMEOUT_MS = 2_000

export type TriggerDispatchKickReason = 'sms_received' | 'run_finished'

let _client: LambdaClient | null = null
function getClient(): LambdaClient {
  return (_client ??= new LambdaClient({}))
}

/** Override the LambdaClient. Tests inject a stub with a mocked `send`. */
export function setTriggerDispatcherLambdaClient(client: LambdaClient | null): void {
  _client = client
}

/** Asks the trigger dispatcher to run now. Returns whether the kick was queued. */
export async function kickTriggerDispatcher(reason: TriggerDispatchKickReason): Promise<boolean> {
  const functionName = process.env['TRIGGER_DISPATCHER_FUNCTION_NAME']
  if (!functionName) return false
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      abort.abort()
      resolve('timeout')
    }, KICK_TIMEOUT_MS)
  })
  try {
    const out = await Promise.race([
      getClient().send(
        new InvokeCommand({
          FunctionName: functionName,
          InvocationType: 'Event',
          Payload: new TextEncoder().encode(JSON.stringify({ source: 'kick', reason })),
        }),
        { abortSignal: abort.signal },
      ),
      timedOut,
    ])
    if (out === 'timeout') {
      logger.warn('trigger dispatcher kick timed out; the next tick will dispatch', { reason })
      return false
    }
    if (out.StatusCode === 202) return true
    logger.warn('trigger dispatcher kick was not accepted', { reason, statusCode: out.StatusCode })
  } catch (err) {
    logger.warn('trigger dispatcher kick failed; the next tick will dispatch', {
      reason,
      error: String(err),
    })
  } finally {
    clearTimeout(timer)
  }
  return false
}
