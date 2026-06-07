// ---------------------------------------------------------------------------
// Temporal client (Cloud + local-dev) for the API Lambda.
//
// The API Lambda is the producer that starts workflows on Temporal Cloud via
// `client.workflow.start(...)`. The Fargate worker (apps/temporal-worker) is
// the consumer — it polls task queues and runs the actual workflows.
//
// Connection model
// ────────────────
// * Production (staging / prod): API-key auth against Temporal Cloud. The key
//   lives in Secrets Manager at `pegasus/{env}/temporal-cloud` as JSON
//   `{ "apiKey": "<jwt>" }`. CDK extracts the `apiKey` field via Secrets
//   Manager dynamic reference and injects it as the env var
//   TEMPORAL_CLOUD_API_KEY — the same pattern DATABASE_URL uses. No AWS
//   SDK call required at runtime. `Connection.connect({ tls: true, apiKey,
//   metadata: { 'temporal-namespace': namespace } })` is the Cloud shape
//   (see hello-world-mtls samples; mTLS uses certs but API-key auth replaces
//   the cert pair with the apiKey field).
// * Local dev: when `TEMPORAL_ADDRESS` is unset (or set to localhost),
//   connects without TLS or auth — matches `docker-compose.temporal.yml`'s
//   bare dev server on `localhost:7233`.
//
// Caching
// ───────
// The Connection is cached at module scope for the Lambda container's
// lifetime. Cold start pays one gRPC handshake; warm invocations reuse.
// This is the standard pattern in this codebase — see apps/api/src/db.ts
// (Prisma) and runtime-token-crypto.ts (KMS client).
//
// Tests: import _setTemporalClientForTesting to inject a mock Client so tests
// don't open a real connection.
// ---------------------------------------------------------------------------

import { Client, Connection } from '@temporalio/client'

// ---------------------------------------------------------------------------
// Env / config helpers
// ---------------------------------------------------------------------------

/**
 * Temporal Cloud address — e.g. `pegasus-staging.chgel.tmprl.cloud:7233`.
 * Unset in dev (we fall through to localhost).
 */
function temporalAddress(): string | undefined {
  return process.env['TEMPORAL_ADDRESS'] || undefined
}

/**
 * Full Temporal Cloud namespace id — `<short>.<account>`. CDK derives this
 * from TEMPORAL_ADDRESS in `bin/app.ts` and injects it explicitly so the
 * runtime doesn't have to re-parse the address (and so a future address-only
 * change can't silently drift from the namespace).
 */
function temporalNamespace(): string {
  return process.env['TEMPORAL_NAMESPACE'] || 'default'
}

/** Task queue name — e.g. `pegasus-stdlib-staging`. */
export function temporalTaskQueue(): string {
  return process.env['TEMPORAL_TASK_QUEUE'] || 'pegasus-stdlib-dev'
}

function temporalCloudApiKey(): string | undefined {
  return process.env['TEMPORAL_CLOUD_API_KEY'] || undefined
}

/** True when we should connect via Temporal Cloud (API key + TLS). */
function usesTemporalCloud(): boolean {
  const addr = temporalAddress()
  if (!addr) return false
  // Defensive: if someone sets TEMPORAL_ADDRESS=localhost:7233 in dev, treat
  // it as local even though the var is set.
  if (addr.startsWith('localhost') || addr.startsWith('127.0.0.1')) return false
  return true
}

// ---------------------------------------------------------------------------
// Client (cached for container lifetime)
// ---------------------------------------------------------------------------

let _client: Promise<Client> | null = null

/**
 * Test injection hook. Tests call this with a fake Client so the handler
 * never reaches the real Temporal SDK. The handler tests use this to stub
 * `client.workflow.start` and assert on its arguments.
 *
 * Passing `null` clears the cache, mirroring the pattern in db.ts.
 */
export function _setTemporalClientForTesting(client: Client | null): void {
  _client = client ? Promise.resolve(client) : null
}

/**
 * Returns the cached Temporal client, constructing it on the first call.
 * Subsequent callers share the same instance for the Lambda container's
 * lifetime — the gRPC connection is long-lived and safe to reuse.
 */
export async function getTemporalClient(): Promise<Client> {
  if (_client) return _client
  _client = (async () => {
    if (usesTemporalCloud()) {
      const apiKey = temporalCloudApiKey()
      if (!apiKey) {
        throw new Error(
          'TEMPORAL_CLOUD_API_KEY is not set — cannot connect to Temporal Cloud',
        )
      }
      const address = temporalAddress()
      if (!address) {
        throw new Error('TEMPORAL_ADDRESS unset despite Cloud mode being on')
      }
      const namespace = temporalNamespace()
      const connection = await Connection.connect({
        address,
        tls: true,
        apiKey,
        // Temporal Cloud uses the metadata header to disambiguate the
        // namespace — required when the API key is account-scoped.
        metadata: { 'temporal-namespace': namespace },
      })
      return new Client({ connection, namespace })
    }
    // Local dev — bare localhost:7233 connection, no TLS, no auth.
    const address = temporalAddress() ?? 'localhost:7233'
    const connection = await Connection.connect({ address })
    return new Client({ connection, namespace: temporalNamespace() })
  })()
  _client.catch(() => {
    _client = null
  })
  return _client
}
