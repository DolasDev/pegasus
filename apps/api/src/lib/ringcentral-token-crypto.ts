// ---------------------------------------------------------------------------
// KMS crypto for the SHARED RingCentral access token
// (ringcentral_access_tokens.token_ciphertext).
//
// Same dedicated key as workflow secrets/runtime tokens (WORKFLOW_TOKEN_KMS_KEY_ID),
// but every ciphertext is bound to an EncryptionContext of
// `{ purpose: 'ringcentral_access_token', connectionId }`. A token row copied
// onto another connection cannot be decrypted for it, and CloudTrail Decrypt
// events show which connection's token was read.
//
// `isRingCentralTokenCryptoConfigured` lets the token service run without the
// shared tier (per-container cache only) where the key isn't wired: unit tests,
// local dev, or a Lambda that infra hasn't granted.
// ---------------------------------------------------------------------------

import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms'

function kmsKeyId(): string {
  const id = process.env['WORKFLOW_TOKEN_KMS_KEY_ID']
  if (!id || id.length === 0) {
    throw new Error('WORKFLOW_TOKEN_KMS_KEY_ID environment variable is not set')
  }
  return id
}

/** True when the KMS key the shared token tier encrypts with is configured. */
export function isRingCentralTokenCryptoConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const id = env['WORKFLOW_TOKEN_KMS_KEY_ID']
  return typeof id === 'string' && id.length > 0
}

let _client: KMSClient | null = null
function client(): KMSClient {
  return (_client ??= new KMSClient({}))
}

function encryptionContext(connectionId: string): Record<string, string> {
  return { purpose: 'ringcentral_access_token', connectionId }
}

/** KMS-encrypts an access token; returns base64 ciphertext bound to the connection. */
export async function encryptRingCentralToken(
  plaintext: string,
  connectionId: string,
): Promise<string> {
  const out = await client().send(
    new EncryptCommand({
      KeyId: kmsKeyId(),
      Plaintext: Buffer.from(plaintext, 'utf8'),
      EncryptionContext: encryptionContext(connectionId),
    }),
  )
  if (!out.CiphertextBlob) throw new Error('KMS Encrypt returned no CiphertextBlob')
  return Buffer.from(out.CiphertextBlob).toString('base64')
}

/** Decrypts a ciphertext from {@link encryptRingCentralToken} for the same connection. */
export async function decryptRingCentralToken(
  ciphertext: string,
  connectionId: string,
): Promise<string> {
  const out = await client().send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(ciphertext, 'base64'),
      EncryptionContext: encryptionContext(connectionId),
    }),
  )
  if (!out.Plaintext) throw new Error('KMS Decrypt returned no Plaintext')
  return Buffer.from(out.Plaintext).toString('utf8')
}
