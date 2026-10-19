// ---------------------------------------------------------------------------
// Fire-and-forget kick of the push forwarder Lambda (lambda-push-forward).
//
// The forwarder drains the push outbox every minute. A caller that just
// enqueued pushes a person is waiting on — move chat — kicks it so they go out
// in seconds instead. Asynchronous (InvocationType 'Event'): Lambda queues the
// run and returns 202 without waiting for it.
//
// Why kick the forwarder rather than call Expo from the API: `expo-server-sdk`
// is ESM-only and needs the forwarder's ESM bundling; pulled into the API's
// CommonJS bundle it would crash the API Lambda at INIT (GOTCHAS, #594). The
// forwarder claims each row before sending (repositories/push-outbox.claimPush),
// so a kicked run overlapping the cron never sends a row twice.
//
// PUSH_FORWARD_FUNCTION_NAME is set by CDK. Unset (local dev, tests) = no-op:
// the rows wait for the next cron tick. Never throws — the message is already
// committed, and a lost kick only costs latency.
// ---------------------------------------------------------------------------

import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import { logger } from './logger'

let _client: LambdaClient | null = null
function getClient(): LambdaClient {
  return (_client ??= new LambdaClient({}))
}

/** Override the LambdaClient. Tests inject a stub with a mocked `send`. */
export function setPushForwarderLambdaClient(client: LambdaClient | null): void {
  _client = client
}

/** Asks the push forwarder to run now. Returns whether the kick was queued. */
export async function kickPushForwarder(): Promise<boolean> {
  const functionName = process.env['PUSH_FORWARD_FUNCTION_NAME']
  if (!functionName) return false
  try {
    const out = await getClient().send(
      new InvokeCommand({ FunctionName: functionName, InvocationType: 'Event' }),
    )
    if (out.StatusCode === 202) return true
    logger.warn('push forwarder kick was not accepted', { statusCode: out.StatusCode })
  } catch (err) {
    logger.warn('push forwarder kick failed; the cron will deliver', { error: String(err) })
  }
  return false
}
