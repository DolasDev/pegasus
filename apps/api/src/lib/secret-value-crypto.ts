// ---------------------------------------------------------------------------
// KMS envelope crypto for workflow secret values.
//
// Workflow SECRET values (WorkflowSecretConfig.valueCiphertext) are encrypted
// here with the same dedicated KMS key used for runtime tokens
// (WORKFLOW_TOKEN_KMS_KEY_ID) — the API Lambda already holds EncryptDecrypt on
// it, so no new infra is required. Unlike runtime-token-crypto.ts, these helpers
// bind every ciphertext to an EncryptionContext of
// `{ purpose: 'workflow_secret_config', tenantId }`:
//   - cross-tenant isolation: a ciphertext minted for tenant A cannot be
//     decrypted while claiming tenant B (KMS authenticates the context), and
//   - auditability: CloudTrail Decrypt events carry the context, so secret
//     reads are attributable per tenant.
//
// Because the existing runtime-token helpers use NO context, a separate pair is
// required — a context-tagged ciphertext cannot be decrypted by a context-free
// call and vice versa. The KMSClient is a lazy singleton (cold-start friendly),
// mirroring runtime-token-crypto.ts.
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

/** Builds the per-tenant encryption context bound into every ciphertext. */
function encryptionContext(tenantId: string): Record<string, string> {
  return { purpose: 'workflow_secret_config', tenantId }
}

/**
 * KMS-encrypts a workflow secret value and returns the ciphertext as a base64
 * string suitable for storage in `WorkflowSecretConfig.valueCiphertext`. The
 * ciphertext is bound to `tenantId` via the encryption context.
 */
export async function encryptSecretValue(plaintext: string, tenantId: string): Promise<string> {
  const out = await client().send(
    new EncryptCommand({
      KeyId: kmsKeyId(),
      Plaintext: Buffer.from(plaintext, 'utf8'),
      EncryptionContext: encryptionContext(tenantId),
    }),
  )
  if (!out.CiphertextBlob) {
    throw new Error('KMS Encrypt returned no CiphertextBlob')
  }
  return Buffer.from(out.CiphertextBlob).toString('base64')
}

/**
 * KMS-decrypts a base64 ciphertext produced by `encryptSecretValue`, returning
 * the original plaintext. The same `tenantId` must be supplied — KMS rejects the
 * decrypt if the encryption context does not match the one used at encrypt time.
 */
export async function decryptSecretValue(ciphertext: string, tenantId: string): Promise<string> {
  const out = await client().send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(ciphertext, 'base64'),
      EncryptionContext: encryptionContext(tenantId),
    }),
  )
  if (!out.Plaintext) {
    throw new Error('KMS Decrypt returned no Plaintext')
  }
  return Buffer.from(out.Plaintext).toString('utf8')
}
