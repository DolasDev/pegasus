// ---------------------------------------------------------------------------
// KMS envelope crypto for per-workflow runtime service-account tokens.
//
// When a workflow is finalized or forked, the API mints a scoped `vnd_` API
// key for the future Temporal runtime worker. The plaintext key is encrypted
// here with a dedicated KMS key and only the ciphertext is persisted on the
// workflow row — the plaintext is discarded immediately and never logged.
//
// `decryptRuntimeToken` is the inverse, used by the future worker-credential
// issue path. Ciphertext crosses the API boundary / database as a base64
// string (KMS returns/accepts raw bytes).
//
// The KMSClient is a lazy singleton so Lambda cold-starts don't pay
// re-instantiation cost on every request — mirrors the S3Client pattern in
// documents-s3.ts.
// ---------------------------------------------------------------------------

import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms'

/** Returns the configured workflow-token KMS key id, throwing if unset. */
function kmsKeyId(): string {
  const id = process.env['WORKFLOW_TOKEN_KMS_KEY_ID']
  if (!id || id.length === 0) {
    throw new Error('WORKFLOW_TOKEN_KMS_KEY_ID environment variable is not set')
  }
  return id
}

let _client: KMSClient | null = null
function client(): KMSClient {
  return (_client ??= new KMSClient({}))
}

/**
 * KMS-encrypts a runtime token plaintext and returns the ciphertext as a
 * base64 string suitable for storage in `Workflow.runtimeTokenCiphertext`.
 */
export async function encryptRuntimeToken(plaintext: string): Promise<string> {
  const out = await client().send(
    new EncryptCommand({
      KeyId: kmsKeyId(),
      Plaintext: Buffer.from(plaintext, 'utf8'),
    }),
  )
  if (!out.CiphertextBlob) {
    throw new Error('KMS Encrypt returned no CiphertextBlob')
  }
  return Buffer.from(out.CiphertextBlob).toString('base64')
}

/**
 * KMS-decrypts a base64 ciphertext produced by `encryptRuntimeToken` and
 * returns the original plaintext token. The key id is implied by the
 * ciphertext blob, so no KeyId is passed.
 */
export async function decryptRuntimeToken(ciphertext: string): Promise<string> {
  const out = await client().send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(ciphertext, 'base64'),
    }),
  )
  if (!out.Plaintext) {
    throw new Error('KMS Decrypt returned no Plaintext')
  }
  return Buffer.from(out.Plaintext).toString('utf8')
}
