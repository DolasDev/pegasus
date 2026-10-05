// ---------------------------------------------------------------------------
// Temporal Cloud Ops API client (Phase 3b) — the minimum the
// temporal-provisioner Lambda needs to create, rotate and delete a tenant's
// namespace, its namespace-scoped Write service account and that account's
// API key.
//
// REST/JSON over `fetch` (there is no official TS SDK). Paths and fields are
// the HTTP bindings in temporalio/api-cloud `cloudservice/v1/service.proto`,
// at the pinned CLOUD_OPS_API_VERSION. Request bodies use the proto field
// names (snake_case); responses are read in either snake_case or lowerCamel,
// since the gateway accepts and may emit both.
//
// Every mutation is asynchronous on Temporal's side: it returns an
// AsyncOperation, which `waitForOperation` polls, honouring `check_duration`.
// The client-supplied `async_operation_id` is Temporal's idempotency key.
//
// Guardrails:
//   * Every mutating call that names a namespace runs `assertProvisionableName`
//     first, so this client can only ever act on `pg-<env>-<12 hex>` names of
//     its own env — defence in depth on top of the Developer-role scoping.
//   * Neither the provisioner key nor a minted key token is ever logged or put
//     in an error message. Logs carry method, path, status and operation id.
// ---------------------------------------------------------------------------

export const CLOUD_OPS_BASE_URL = 'https://saas-api.tmprl.cloud'
export const CLOUD_OPS_API_VERSION = 'v0.23.0'

const DEFAULT_POLL_MS = 2_000
const MIN_POLL_MS = 1_000
const MAX_POLL_MS = 30_000

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ENV_REGEX = /^[a-z]+$/

/** `pg-<env>-<first 12 hex of the tenant id>`, e.g. `pg-staging-a90b22bc4393`. */
export function tenantNamespaceName(env: string, tenantId: string): string {
  if (!ENV_REGEX.test(env)) throw new Error(`invalid env name: ${env}`)
  if (!UUID_REGEX.test(tenantId)) throw new Error('tenantId is not a lowercase UUID')
  return `pg-${env}-${tenantId.replace(/-/g, '').slice(0, 12)}`
}

/**
 * Throws unless `name` is a tenant namespace of `env`: `pg-<env>-<12 hex>`,
 * optionally with its `.<account>` suffix. Nothing else — not the platform
 * namespace, not another env's tenant namespaces — is provisionable.
 */
export function assertProvisionableName(env: string, name: string): void {
  if (!ENV_REGEX.test(env)) throw new Error(`invalid env name: ${env}`)
  const re = new RegExp(`^pg-${env}-[0-9a-f]{12}(\\.[a-z0-9]+)?$`)
  if (!re.test(name)) {
    throw new Error(`refusing Cloud Ops call: '${name}' is not a provisionable ${env} namespace`)
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class CloudOpsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'CloudOpsError'
  }
}

/** 401/403 — the provisioner key is wrong, expired, or lacks the permission. */
export class CloudOpsAuthError extends CloudOpsError {
  constructor(message: string, status: number) {
    super(message, status)
    this.name = 'CloudOpsAuthError'
  }
}

/** 409 — already exists, or a stale `resource_version`. */
export class CloudOpsConflictError extends CloudOpsError {
  constructor(message: string, status: number) {
    super(message, status)
    this.name = 'CloudOpsConflictError'
  }
}

/** The async operation ended FAILED, CANCELLED or REJECTED, or never finished. */
export class CloudOpsOperationError extends CloudOpsError {
  constructor(message: string) {
    super(message)
    this.name = 'CloudOpsOperationError'
  }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())
}

/** Reads `key` (snake_case) or its lowerCamel form. */
function field(obj: unknown, key: string): unknown {
  if (obj === null || typeof obj !== 'object') return undefined
  const o = obj as Json
  return key in o ? o[key] : o[snakeToCamel(key)]
}

function str(obj: unknown, key: string): string {
  const v = field(obj, key)
  return typeof v === 'string' ? v : ''
}

/** Parses a protobuf JSON Duration (`"1.5s"`) to milliseconds; null if absent. */
function durationMs(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const m = /^(\d+(?:\.\d+)?)s$/.exec(value)
  return m ? Math.round(Number(m[1]) * 1000) : null
}

export type AsyncOperation = {
  id: string
  state: string
  checkDurationMs: number | null
  failureReason: string
}

function parseOperation(raw: unknown): AsyncOperation {
  return {
    id: str(raw, 'id'),
    state: str(raw, 'state'),
    checkDurationMs: durationMs(field(raw, 'check_duration')),
    failureReason: str(raw, 'failure_reason'),
  }
}

function operationId(body: unknown): string {
  return parseOperation(field(body, 'async_operation')).id
}

const TERMINAL_FAILURES = new Set(['STATE_FAILED', 'STATE_CANCELLED', 'STATE_REJECTED'])

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export type CloudOpsLogger = {
  info(message: string, meta: Record<string, unknown>): void
  warn(message: string, meta: Record<string, unknown>): void
  error(message: string, meta: Record<string, unknown>): void
}

export type CloudOpsClientOptions = {
  /** The provisioner's Cloud Ops API key. Never logged. */
  apiKey: string
  /** Deploy env (`staging`, `prod`): the only env whose names this client may touch. */
  env: string
  logger: CloudOpsLogger
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  baseUrl?: string
}

export function createTemporalCloudOpsClient(opts: CloudOpsClientOptions) {
  const doFetch = opts.fetch ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = opts.now ?? Date.now
  const baseUrl = opts.baseUrl ?? CLOUD_OPS_BASE_URL
  const { env, logger: log } = opts

  async function request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    {
      body,
      query,
      allow404 = false,
    }: { body?: Json; query?: Record<string, string>; allow404?: boolean } = {},
  ): Promise<unknown> {
    const qs = query ? `?${new URLSearchParams(query).toString()}` : ''
    const res = await doFetch(`${baseUrl}${path}${qs}`, {
      method,
      headers: {
        authorization: `Bearer ${opts.apiKey}`,
        'temporal-cloud-api-version': CLOUD_OPS_API_VERSION,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const text = await res.text()
    // Path only — never the query (harmless today) and never a body.
    log.info('temporal_cloud_ops.request', {
      audit: method !== 'GET',
      method,
      path,
      status: res.status,
      asyncOperationId: body ? body['async_operation_id'] : query?.['async_operation_id'],
    })

    if (res.status === 404 && allow404) return null
    if (!res.ok) {
      // Error bodies are Temporal's `{code, message}`; only the message is kept.
      let detail = ''
      try {
        detail = str(JSON.parse(text), 'message')
      } catch {
        // Non-JSON error body: report the status alone.
      }
      const message = `Cloud Ops ${method} ${path} failed with ${res.status}${detail ? `: ${detail}` : ''}`
      if (res.status === 401 || res.status === 403) throw new CloudOpsAuthError(message, res.status)
      if (res.status === 409) throw new CloudOpsConflictError(message, res.status)
      throw new CloudOpsError(message, res.status)
    }
    return text.length === 0 ? {} : (JSON.parse(text) as unknown)
  }

  const enc = encodeURIComponent

  async function getOperation(id: string): Promise<AsyncOperation> {
    const body = await request('GET', `/cloud/operations/${enc(id)}`)
    return parseOperation(field(body, 'async_operation'))
  }

  return {
    async createNamespace(input: {
      name: string
      retentionDays: number
      region: string
      asyncOperationId: string
    }): Promise<{ namespace: string; asyncOperationId: string }> {
      assertProvisionableName(env, input.name)
      const body = await request('POST', '/cloud/namespaces', {
        body: {
          spec: {
            name: input.name,
            retention_days: input.retentionDays,
            api_key_auth: { enabled: true },
            replicas: [{ region: input.region }],
          },
          async_operation_id: input.asyncOperationId,
        },
      })
      return { namespace: str(body, 'namespace'), asyncOperationId: operationId(body) }
    },

    /** Null when the namespace doesn't exist (or isn't visible to this key). */
    async getNamespace(namespace: string): Promise<{
      namespace: string
      resourceVersion: string
      state: string
      grpcAddress: string
    } | null> {
      const body = await request('GET', `/cloud/namespaces/${enc(namespace)}`, { allow404: true })
      if (body === null) return null
      const ns = field(body, 'namespace')
      return {
        namespace: str(ns, 'namespace'),
        resourceVersion: str(ns, 'resource_version'),
        state: str(ns, 'state'),
        grpcAddress: str(field(ns, 'endpoints'), 'grpc_address'),
      }
    },

    /** Deleting a namespace also removes the service accounts scoped to it. */
    async deleteNamespace(input: {
      namespace: string
      resourceVersion: string
      asyncOperationId: string
    }): Promise<{ asyncOperationId: string }> {
      assertProvisionableName(env, input.namespace)
      const body = await request('DELETE', `/cloud/namespaces/${enc(input.namespace)}`, {
        query: {
          resource_version: input.resourceVersion,
          async_operation_id: input.asyncOperationId,
        },
      })
      return { asyncOperationId: operationId(body) }
    },

    /** A service account with Write on one namespace and no account-level role. */
    async createScopedServiceAccount(input: {
      name: string
      namespace: string
      description?: string
      asyncOperationId: string
    }): Promise<{ serviceAccountId: string; asyncOperationId: string }> {
      assertProvisionableName(env, input.namespace)
      const body = await request('POST', '/cloud/service-accounts', {
        body: {
          spec: {
            name: input.name,
            ...(input.description ? { description: input.description } : {}),
            namespace_scoped_access: {
              namespace: input.namespace,
              access: { permission: 'PERMISSION_WRITE' },
            },
          },
          async_operation_id: input.asyncOperationId,
        },
      })
      return {
        serviceAccountId: str(body, 'service_account_id'),
        asyncOperationId: operationId(body),
      }
    },

    /** Finds a service account by exact name (to resume after a lost create response). */
    async findServiceAccountByName(name: string): Promise<{ id: string } | null> {
      let pageToken = ''
      do {
        const body = await request('GET', '/cloud/service-accounts', {
          query: pageToken ? { page_token: pageToken } : {},
        })
        const accounts = field(body, 'service_account')
        for (const sa of Array.isArray(accounts) ? accounts : []) {
          if (str(field(sa, 'spec'), 'name') === name) return { id: str(sa, 'id') }
        }
        pageToken = str(body, 'next_page_token')
      } while (pageToken)
      return null
    },

    /** The token is returned ONCE — the caller must store it before anything else. */
    async createApiKey(input: {
      ownerId: string
      displayName: string
      expiryTime: Date
      asyncOperationId: string
    }): Promise<{ keyId: string; token: string; asyncOperationId: string }> {
      const body = await request('POST', '/cloud/api-keys', {
        body: {
          spec: {
            owner_id: input.ownerId,
            owner_type: 'OWNER_TYPE_SERVICE_ACCOUNT',
            display_name: input.displayName,
            expiry_time: input.expiryTime.toISOString(),
          },
          async_operation_id: input.asyncOperationId,
        },
      })
      return {
        keyId: str(body, 'key_id'),
        token: str(body, 'token'),
        asyncOperationId: operationId(body),
      }
    },

    async getApiKey(keyId: string): Promise<{ id: string; resourceVersion: string } | null> {
      const body = await request('GET', `/cloud/api-keys/${enc(keyId)}`, { allow404: true })
      if (body === null) return null
      const key = field(body, 'api_key')
      return { id: str(key, 'id'), resourceVersion: str(key, 'resource_version') }
    },

    /** Every key owned by a service account (to clean up a key whose token was lost). */
    async listApiKeys(ownerId: string): Promise<Array<{ id: string; resourceVersion: string }>> {
      const keys: Array<{ id: string; resourceVersion: string }> = []
      let pageToken = ''
      do {
        const body = await request('GET', '/cloud/api-keys', {
          query: {
            owner_id: ownerId,
            owner_type: 'OWNER_TYPE_SERVICE_ACCOUNT',
            ...(pageToken ? { page_token: pageToken } : {}),
          },
        })
        const page = field(body, 'api_keys')
        for (const k of Array.isArray(page) ? page : []) {
          keys.push({ id: str(k, 'id'), resourceVersion: str(k, 'resource_version') })
        }
        pageToken = str(body, 'next_page_token')
      } while (pageToken)
      return keys
    },

    async deleteApiKey(input: {
      keyId: string
      resourceVersion: string
      asyncOperationId: string
    }): Promise<{ asyncOperationId: string }> {
      const body = await request('DELETE', `/cloud/api-keys/${enc(input.keyId)}`, {
        query: {
          resource_version: input.resourceVersion,
          async_operation_id: input.asyncOperationId,
        },
      })
      return { asyncOperationId: operationId(body) }
    },

    getOperation,

    /**
     * Polls until the operation is FULFILLED (resolves) or ends FAILED,
     * CANCELLED or REJECTED (throws). Sleeps for the server's
     * `check_duration`, clamped to 1–30 s.
     */
    async waitForOperation(
      id: string,
      { timeoutMs }: { timeoutMs: number },
    ): Promise<AsyncOperation> {
      const start = now()
      for (;;) {
        const op = await getOperation(id)
        if (op.state === 'STATE_FULFILLED') return op
        if (TERMINAL_FAILURES.has(op.state)) {
          throw new CloudOpsOperationError(
            `Cloud Ops operation ${id} ended ${op.state}${op.failureReason ? `: ${op.failureReason}` : ''}`,
          )
        }
        const delay = Math.min(
          MAX_POLL_MS,
          Math.max(MIN_POLL_MS, op.checkDurationMs ?? DEFAULT_POLL_MS),
        )
        if (now() - start + delay > timeoutMs) {
          throw new CloudOpsOperationError(`Cloud Ops operation ${id} timed out in ${op.state}`)
        }
        await sleep(delay)
      }
    },
  }
}

export type TemporalCloudOpsClient = ReturnType<typeof createTemporalCloudOpsClient>
