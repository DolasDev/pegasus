// ---------------------------------------------------------------------------
// temporal-provisioner Lambda (Phase 3b) — creates, rotates and deletes a
// tenant's own Temporal Cloud namespace, and keeps every Temporal key from
// expiring unnoticed. The logic is in lib/temporal-provisioner.ts; this file
// wires the real dependencies.
//
// Invoked asynchronously (InvocationType 'Event') by the admin routes in
// handlers/admin/tenants.ts with `{action, tenantId}`, daily by the schedule
// with `{action: 'daily-maintenance'}`, and by hand with
// `{action: 'rotate-own-key', force?: true}`.
//
// It holds the per-env provisioner's Cloud Ops API key, which is why it is
// its own function and not the API Lambda: the Cloud credential never sits
// in the request path. The key is read from Secrets Manager at runtime
// (TEMPORAL_PROVISIONER_SECRET_ARN, JSON `{"apiKey": "...", "keyId"?: "...",
// "expiresAt"?: "..."}`), never injected as a plaintext env var. The function
// may WRITE that secret (self-rotation) and no other. Of the platform key's
// secret (TEMPORAL_PLATFORM_SECRET_ARN) it reads only metadata — the
// `expiresAt` tag, through DescribeSecret — never the value.
//
// NOT in the WireGuard VPC: 3a's DNS Firewall blocks saas-api.tmprl.cloud
// there.
// ---------------------------------------------------------------------------

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import {
  DescribeSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import { db } from './db'
import { createLogger } from './lib/logger'
import { createTemporalCloudOpsClient } from './lib/temporal-cloud-ops'
import { keyAuthorizedOnNamespace } from './lib/temporal-namespace-readiness'
import {
  runTemporalProvisioner,
  type KeyMetric,
  type ProvisionerEvent,
  type ProvisionerResult,
} from './lib/temporal-provisioner'
import { createTenantTemporalNamespaceRepository } from './repositories/tenant-temporal-namespace.repository'

const logger = createLogger('pegasus-temporal-provisioner')
const secretsManager = new SecretsManagerClient({})
const cloudwatch = new CloudWatchClient({})

/** Must equal PEGASUS_WORKFLOWS_METRIC_NAMESPACE in packages/infra/lib/metrics.ts. */
const METRIC_NAMESPACE = 'Pegasus/Workflows'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

/** The provisioner secret's JSON. Only `apiKey` is required. */
type ProvisionerSecret = Record<string, unknown> & { apiKey: string }

async function readProvisionerSecret(secretArn: string): Promise<ProvisionerSecret> {
  const out = await secretsManager.send(new GetSecretValueCommand({ SecretId: secretArn }))
  const parsed: unknown = JSON.parse(out.SecretString ?? '{}')
  const apiKey = (parsed as { apiKey?: unknown }).apiKey
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('provisioner secret has no apiKey field')
  }
  return parsed as ProvisionerSecret
}

/**
 * The platform key's expiry, from the `expiresAt` tag that
 * scripts/temporal/rotate-platform-key.sh sets. DescribeSecret returns
 * metadata only: this function never holds the platform key itself.
 */
async function platformKeyExpiresAt(): Promise<Date | null> {
  const arn = process.env['TEMPORAL_PLATFORM_SECRET_ARN']
  if (!arn) return null
  const out = await secretsManager.send(new DescribeSecretCommand({ SecretId: arn }))
  const tag = out.Tags?.find((t) => t.Key === 'expiresAt')?.Value
  const ms = tag ? Date.parse(tag) : Number.NaN
  return Number.isNaN(ms) ? null : new Date(ms)
}

async function publishMetrics(metrics: KeyMetric[]): Promise<void> {
  const timestamp = new Date()
  await cloudwatch.send(
    new PutMetricDataCommand({
      Namespace: METRIC_NAMESPACE,
      MetricData: metrics.map((m) => ({
        MetricName: m.name,
        Value: m.value,
        Unit: 'Count',
        Timestamp: timestamp,
        Dimensions: 'keyClass' in m ? [{ Name: 'KeyClass', Value: m.keyClass }] : [],
      })),
    }),
  )
}

function isProvisionerEvent(event: unknown): event is ProvisionerEvent {
  if (typeof event !== 'object' || event === null) return false
  const e = event as Record<string, unknown>
  if (e['action'] === 'retire-previous-keys' || e['action'] === 'daily-maintenance') return true
  if (e['action'] === 'rotate-own-key') {
    return e['force'] === undefined || typeof e['force'] === 'boolean'
  }
  return (
    (e['action'] === 'provision' || e['action'] === 'rotate' || e['action'] === 'deprovision') &&
    typeof e['tenantId'] === 'string'
  )
}

export async function handler(event: unknown): Promise<ProvisionerResult> {
  if (!isProvisionerEvent(event)) {
    logger.error('temporal_provisioner.bad_event', { event })
    throw new Error('invalid provisioner event')
  }
  const secretArn = requireEnv('TEMPORAL_PROVISIONER_SECRET_ARN')
  const secret = await readProvisionerSecret(secretArn)
  const env = requireEnv('ENV_NAME')
  return runTemporalProvisioner(event, {
    repo: createTenantTemporalNamespaceRepository(db),
    cloud: createTemporalCloudOpsClient({ apiKey: secret.apiKey, env, logger }),
    env,
    checkReady: keyAuthorizedOnNamespace,
    ownKey: {
      recordedKeyId: async () => (typeof secret['keyId'] === 'string' ? secret['keyId'] : null),
      // A fresh client on the NEW token: proves the token itself authenticates.
      verify: async (token, keyId) => {
        const fresh = createTemporalCloudOpsClient({ apiKey: token, env, logger })
        return (await fresh.listOwnApiKeys()).some((k) => k.id === keyId)
      },
      // Keeps any other field already in the secret.
      store: async ({ apiKey, keyId, expiresAt }) => {
        await secretsManager.send(
          new PutSecretValueCommand({
            SecretId: secretArn,
            SecretString: JSON.stringify({
              ...secret,
              apiKey,
              keyId,
              expiresAt: expiresAt.toISOString(),
            }),
          }),
        )
      },
    },
    platformKeyExpiresAt,
    publishMetrics,
    logger,
  })
}
