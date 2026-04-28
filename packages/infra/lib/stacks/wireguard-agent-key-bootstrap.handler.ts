// ---------------------------------------------------------------------------
// Custom Resource — agent API key bootstrap.
//
// First deploy: generates a fresh `vnd_<48 hex>` token, writes the plaintext
// to /pegasus/wireguard/agent/apikey (SecureString) and the SHA-256 hex hash
// to /pegasus/wireguard/agent/apikey-hash (plain String). Returns the hash
// as a CR Data attribute so ApiStack can inject it as a Lambda env var
// without a separate SSM round-trip.
//
// Re-deploy: reads the existing plaintext from SSM and re-emits its hash.
// If the apikey was seeded out-of-band (e.g. via the legacy bootstrap
// script) the hash gets reconciled from the live plaintext on next deploy.
// NEVER overwrites an existing plaintext — rotation requires the runbook.
//
// Delete: noop. Both params are retained so `cdk destroy` + `cdk deploy`
// does not invalidate a running hub agent.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'
import {
  SSMClient,
  GetParameterCommand,
  PutParameterCommand,
  ParameterNotFound,
} from '@aws-sdk/client-ssm'

interface Event {
  RequestType: 'Create' | 'Update' | 'Delete'
  ResourceProperties: {
    ApiKeyParameterName: string
    ApiKeyHashParameterName: string
  }
  PhysicalResourceId?: string
}

interface Response {
  PhysicalResourceId: string
  Data: { ApiKeyHash: string }
}

const ssm = new SSMClient({})

export async function handler(event: Event): Promise<Response> {
  const { RequestType, ResourceProperties } = event
  const { ApiKeyParameterName, ApiKeyHashParameterName } = ResourceProperties

  if (RequestType === 'Delete') {
    return {
      PhysicalResourceId: event.PhysicalResourceId ?? 'pegasus-wireguard-agent-apikey',
      Data: { ApiKeyHash: '' },
    }
  }

  const existing = await readParameter(ApiKeyParameterName, true)
  const plaintext = existing ?? generateApiKey()
  const hash = crypto.createHash('sha256').update(plaintext).digest('hex')

  if (existing === null) {
    await ssm.send(
      new PutParameterCommand({
        Name: ApiKeyParameterName,
        Type: 'SecureString',
        Value: plaintext,
        Overwrite: false,
      }),
    )
  }

  // Always (re)write the hash so it stays in sync with the plaintext, even
  // if the plaintext was seeded out-of-band before this CR ever ran.
  await ssm.send(
    new PutParameterCommand({
      Name: ApiKeyHashParameterName,
      Type: 'String',
      Value: hash,
      Overwrite: true,
    }),
  )

  return {
    PhysicalResourceId: 'pegasus-wireguard-agent-apikey',
    Data: { ApiKeyHash: hash },
  }
}

async function readParameter(name: string, decrypt: boolean): Promise<string | null> {
  try {
    const res = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: decrypt }))
    return res.Parameter?.Value ?? null
  } catch (err) {
    if (err instanceof ParameterNotFound) return null
    throw err
  }
}

function generateApiKey(): string {
  // Mirror apps/api/src/repositories/api-client.repository.ts: vnd_<48 hex>.
  return `vnd_${crypto.randomBytes(24).toString('hex')}`
}
