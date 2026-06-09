// ---------------------------------------------------------------------------
// RingCentral per-connection credential storage (Secrets Manager).
//
// With bring-your-own JWT auth a connection's durable credential is the tenant's
// { clientId, clientSecret, jwt } (+ optional apiBase). Those are stored as one
// JSON secret per connection in Secrets Manager — only its ARN is persisted on
// the connection row (the `tokenSecretArn` column), never the values, and they
// are never returned by any API. Mirrors the SSO secretArn rule.
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

/** The per-connection credential blob stored in Secrets Manager. */
export interface ConnectionCredentials {
  clientId: string
  clientSecret: string
  jwt: string
  /** Optional RingCentral environment pinned at connect time. */
  apiBase?: string
}

/**
 * The secret name for a connection's credentials. Prefix comes from
 * `RINGCENTRAL_SECRET_PREFIX` (e.g. `pegasus/staging/ringcentral`), set per env
 * by the CDK stack; falls back to a local prefix for dev.
 */
export function connectionSecretName(connectionId: string): string {
  const prefix = process.env['RINGCENTRAL_SECRET_PREFIX'] ?? 'pegasus/local/ringcentral'
  return `${prefix}/${connectionId}`
}

/**
 * Stores (creating or updating) a connection's credentials and returns the
 * secret's ARN. Idempotent: a re-connect for the same connection overwrites the
 * existing secret value rather than failing.
 */
export async function storeConnectionCredentials(
  connectionId: string,
  creds: ConnectionCredentials,
): Promise<string> {
  const name = connectionSecretName(connectionId)
  const secretString = JSON.stringify(creds)
  let alreadyExists = false
  let createArn: string | undefined
  try {
    const out = await client().send(
      new CreateSecretCommand({ Name: name, SecretString: secretString }),
    )
    createArn = out.ARN
  } catch (err) {
    if (!(err instanceof ResourceExistsException)) throw err
    alreadyExists = true
  }

  if (alreadyExists) {
    // Secret already exists (re-connect) — overwrite its value.
    const out = await client().send(
      new PutSecretValueCommand({ SecretId: name, SecretString: secretString }),
    )
    if (!out.ARN) throw new Error('PutSecretValue returned no ARN')
    return out.ARN
  }
  if (!createArn) throw new Error('CreateSecret returned no ARN')
  return createArn
}

/** Reads + parses a connection's credentials from its stored secret ARN. */
export async function getConnectionCredentials(secretArn: string): Promise<ConnectionCredentials> {
  const out = await client().send(new GetSecretValueCommand({ SecretId: secretArn }))
  if (!out.SecretString) {
    throw new Error(`Secret ${secretArn} has no string value`)
  }
  return JSON.parse(out.SecretString) as ConnectionCredentials
}

/**
 * Best-effort delete of a connection's credential secret on disconnect.
 * Force-deletes (no recovery window) so the per-connection name is freed
 * immediately for a future re-connect. A missing secret is swallowed — the
 * connection row may have been created before its secret was ever written — so
 * disconnect never fails on the secret side.
 */
export async function deleteConnectionCredentials(secretArn: string): Promise<void> {
  try {
    await client().send(
      new DeleteSecretCommand({ SecretId: secretArn, ForceDeleteWithoutRecovery: true }),
    )
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      logger.warn('RingCentral credential secret already absent on delete', { secretArn })
      return
    }
    throw err
  }
}

/** Test-only: reset the memoised client so a mock can be installed per test. */
export function __resetSecretsClientForTests(): void {
  _client = null
}
