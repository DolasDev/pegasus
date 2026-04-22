// ---------------------------------------------------------------------------
// Custom Resource — one-shot hub keypair bootstrap.
//
// First deploy: generates an X25519 keypair and writes both halves to SSM
// (`/pegasus/wireguard/hub/privkey` as SecureString, `/pegasus/wireguard/hub/pubkey`
// as plain String). Returns the public key as a CR Data attribute so the
// stack can forward it to ApiStack without another SSM round-trip at deploy.
//
// Re-deploy: if the params already exist (e.g. operator seeded manually, or
// CR ran on a prior deploy), reads the existing public key and returns it.
// NEVER regenerates — rotating requires the runbook.
//
// Delete: noop. The params are retained so `cdk destroy` + `cdk deploy` does
// not invalidate every tenant's client.conf.
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
    PrivateKeyParameterName: string
    PublicKeyParameterName: string
  }
  PhysicalResourceId?: string
}

interface Response {
  PhysicalResourceId: string
  Data: { PublicKey: string }
}

const ssm = new SSMClient({})

export async function handler(event: Event): Promise<Response> {
  const { RequestType, ResourceProperties } = event
  const { PrivateKeyParameterName, PublicKeyParameterName } = ResourceProperties

  if (RequestType === 'Delete') {
    return {
      PhysicalResourceId: event.PhysicalResourceId ?? 'pegasus-wireguard-hub-keys',
      Data: { PublicKey: '' },
    }
  }

  const existing = await readPublicKey(PublicKeyParameterName)
  if (existing !== null) {
    return {
      PhysicalResourceId: 'pegasus-wireguard-hub-keys',
      Data: { PublicKey: existing },
    }
  }

  const { privateKey, publicKey } = generateKeypair()
  await ssm.send(
    new PutParameterCommand({
      Name: PrivateKeyParameterName,
      Type: 'SecureString',
      Value: privateKey,
      Overwrite: false,
    }),
  )
  await ssm.send(
    new PutParameterCommand({
      Name: PublicKeyParameterName,
      Type: 'String',
      Value: publicKey,
      Overwrite: false,
    }),
  )

  return {
    PhysicalResourceId: 'pegasus-wireguard-hub-keys',
    Data: { PublicKey: publicKey },
  }
}

async function readPublicKey(name: string): Promise<string | null> {
  try {
    const res = await ssm.send(new GetParameterCommand({ Name: name }))
    return res.Parameter?.Value ?? null
  } catch (err) {
    if (err instanceof ParameterNotFound) return null
    throw err
  }
}

function generateKeypair(): { privateKey: string; publicKey: string } {
  // Node's X25519 generator produces the clamped scalar directly — the same
  // 32-byte value `wg genkey` outputs. We extract raw bytes via JWK (the
  // only format with a stable layout across Node versions) and re-encode as
  // standard base64 for WireGuard compatibility.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519')
  const privJwk = privateKey.export({ format: 'jwk' })
  const pubJwk = publicKey.export({ format: 'jwk' })

  if (!privJwk.d || !pubJwk.x) {
    throw new Error('x25519 keypair JWK is missing d / x — Node runtime returned unexpected shape')
  }

  return {
    privateKey: base64UrlToBase64(privJwk.d),
    publicKey: base64UrlToBase64(pubJwk.x),
  }
}

function base64UrlToBase64(b64url: string): string {
  return Buffer.from(b64url, 'base64url').toString('base64')
}
