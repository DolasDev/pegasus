// ---------------------------------------------------------------------------
// Fire-and-forget invoke of the support triage worker (lambda-support-triage).
//
// A triage draft takes one model call (tens of seconds on a slow model), too
// close to API Gateway's 29 s cap to run in the request. The API writes the
// `pending` draft row, invokes the worker asynchronously (InvocationType
// 'Event': Lambda queues it and returns 202), and admin-web polls the thread.
//
// SUPPORT_TRIAGE_FUNCTION_NAME is set by CDK. Unset (local dev, tests) = no
// worker: the caller runs the draft in-process instead (support/triage.ts).
// Never throws — a lost invoke leaves the draft `pending`, which reads as
// `failed` after TRIAGE_STALE_AFTER_MS, and the operator can re-draft.
// ---------------------------------------------------------------------------

import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import { logger } from './logger'

let _client: LambdaClient | null = null
function getClient(): LambdaClient {
  return (_client ??= new LambdaClient({}))
}

/** Override the LambdaClient. Tests inject a stub with a mocked `send`. */
export function setSupportTriageLambdaClient(client: LambdaClient | null): void {
  _client = client
}

export function supportTriageFunctionName(): string | null {
  return process.env['SUPPORT_TRIAGE_FUNCTION_NAME'] || null
}

/** The worker event. */
export interface SupportTriageEvent {
  readonly draftId: string
}

export function isSupportTriageEvent(event: unknown): event is SupportTriageEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    typeof (event as Record<string, unknown>)['draftId'] === 'string'
  )
}

/** Queues the worker for one draft. Returns whether Lambda accepted the event. */
export async function invokeSupportTriage(draftId: string): Promise<boolean> {
  const functionName = supportTriageFunctionName()
  if (!functionName) return false
  try {
    const out = await getClient().send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ draftId } satisfies SupportTriageEvent)),
      }),
    )
    if (out.StatusCode === 202) return true
    logger.error('support triage invoke was not accepted', { draftId, statusCode: out.StatusCode })
  } catch (err) {
    logger.error('support triage invoke failed', { draftId, error: String(err) })
  }
  return false
}
