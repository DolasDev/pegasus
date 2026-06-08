// ---------------------------------------------------------------------------
// RingCentral refresh-token storage (Secrets Manager).
//
// The rotating OAuth refresh token is the long-lived credential for a
// RingCentralConnection. It is stored in Secrets Manager (one secret per
// connection) and only its ARN is persisted on the connection row — never the
// token itself, and never returned by any API. Mirrors the SSO secretArn rule.
// ---------------------------------------------------------------------------

import {
  SecretsManagerClient,
  CreateSecretCommand,
  PutSecretValueCommand,
  GetSecretValueCommand,
  DeleteSecretCommand,
  ResourceExistsException,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager'
import { logger } from './logger'

let _client: SecretsManagerClient | null = null
function client(): SecretsManagerClient {
  return (_client ??= new SecretsManagerClient({}))
}

/**
 * The secret name for a connection's refresh token. Prefix comes from
 * `RINGCENTRAL_SECRET_PREFIX` (e.g. `pegasus/staging/ringcentral`), set per env
 * by the CDK stack; falls back to a local prefix for dev.
 */
export function refreshTokenSecretName(connectionId: string): string {
  const prefix = process.env['RINGCENTRAL_SECRET_PREFIX'] ?? 'pegasus/local/ringcentral'
  return `${prefix}/${connectionId}`
}

/**
 * Stores (creating or updating) the refresh token for a connection and returns
 * the secret's ARN. Idempotent: a re-connect for the same connection overwrites
 * the existing secret value rather than failing.
 */
export async function storeRefreshToken(
  connectionId: string,
  refreshToken: string,
): Promise<string> {
  const name = refreshTokenSecretName(connectionId)
  let alreadyExists = false
  let createArn: string | undefined
  try {
    const out = await client().send(
      new CreateSecretCommand({ Name: name, SecretString: refreshToken }),
    )
    createArn = out.ARN
  } catch (err) {
    if (!(err instanceof ResourceExistsException)) throw err
    alreadyExists = true
  }

  if (alreadyExists) {
    // Secret already exists (re-connect) — rotate its value.
    const out = await client().send(
      new PutSecretValueCommand({ SecretId: name, SecretString: refreshToken }),
    )
    if (!out.ARN) throw new Error('PutSecretValue returned no ARN')
    return out.ARN
  }
  if (!createArn) throw new Error('CreateSecret returned no ARN')
  return createArn
}

/** Reads the refresh token for a connection from its stored secret ARN. */
export async function getRefreshToken(secretArn: string): Promise<string> {
  const out = await client().send(new GetSecretValueCommand({ SecretId: secretArn }))
  if (!out.SecretString) {
    throw new Error(`Secret ${secretArn} has no string value`)
  }
  return out.SecretString
}

/**
 * Best-effort delete of a connection's refresh-token secret on disconnect.
 * Force-deletes (no 7-30d recovery window) so the per-connection name is freed
 * immediately for a future re-connect. A missing secret is swallowed — the
 * connection row may have been created before its secret was ever written — so
 * disconnect never fails on the secret side.
 */
export async function deleteRefreshToken(secretArn: string): Promise<void> {
  try {
    await client().send(
      new DeleteSecretCommand({ SecretId: secretArn, ForceDeleteWithoutRecovery: true }),
    )
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      logger.warn('RingCentral refresh-token secret already absent on delete', { secretArn })
      return
    }
    throw err
  }
}

/** Test-only: reset the memoised client so a mock can be installed per test. */
export function __resetSecretsClientForTests(): void {
  _client = null
}
