// ---------------------------------------------------------------------------
// Fire-and-forget invoke of the temporal-provisioner Lambda (Phase 3b).
//
// The admin routes start a provision / rotate / deprovision and return 202;
// the provisioner records progress on the TenantTemporalNamespace row, which
// admin-web polls. InvocationType 'Event' = asynchronous: Lambda queues the
// event and returns 202 without waiting for the run.
//
// TEMPORAL_PROVISIONER_FUNCTION_NAME is set by CDK only when the provisioner
// exists (its secret ARN is configured). Unset = provisioning is not
// configured for this environment.
// ---------------------------------------------------------------------------

import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import type { ProvisionerEvent } from './temporal-provisioner'

let _client: LambdaClient | null = null
function getClient(): LambdaClient {
  return (_client ??= new LambdaClient({}))
}

/** Override the LambdaClient. Tests inject a stub with a mocked `send`. */
export function setTemporalProvisionerLambdaClient(client: LambdaClient | null): void {
  _client = client
}

/** The provisioner's function name, or null when provisioning isn't configured. */
export function temporalProvisionerFunctionName(): string | null {
  return process.env['TEMPORAL_PROVISIONER_FUNCTION_NAME'] || null
}

export async function invokeTemporalProvisioner(event: ProvisionerEvent): Promise<void> {
  const functionName = temporalProvisionerFunctionName()
  if (!functionName) throw new Error('TEMPORAL_PROVISIONER_FUNCTION_NAME is not set')
  const out = await getClient().send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(event)),
    }),
  )
  if (out.StatusCode !== 202) {
    throw new Error(`async invoke of the provisioner returned ${out.StatusCode}`)
  }
}
