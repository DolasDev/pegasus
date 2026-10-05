// ---------------------------------------------------------------------------
// temporal-provisioner Lambda (Phase 3b) — creates, rotates and deletes a
// tenant's own Temporal Cloud namespace. The logic is in
// lib/temporal-provisioner.ts; this file wires the real dependencies.
//
// Invoked asynchronously (InvocationType 'Event') by the admin routes in
// handlers/admin/tenants.ts with `{action, tenantId}`, and on a schedule with
// `{action: 'retire-previous-keys'}`.
//
// It holds the per-env provisioner's Cloud Ops API key, which is why it is
// its own function and not the API Lambda: the Cloud credential never sits
// in the request path. The key is read from Secrets Manager at runtime
// (TEMPORAL_PROVISIONER_SECRET_ARN, JSON `{"apiKey": "..."}`), never injected
// as a plaintext env var. NOT in the WireGuard VPC: 3a's DNS Firewall blocks
// saas-api.tmprl.cloud there.
// ---------------------------------------------------------------------------

import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { Connection } from '@temporalio/client'
import { db } from './db'
import { createLogger } from './lib/logger'
import { createTemporalCloudOpsClient } from './lib/temporal-cloud-ops'
import {
  runTemporalProvisioner,
  type ProvisionerEvent,
  type ProvisionerResult,
} from './lib/temporal-provisioner'
import { createTenantTemporalNamespaceRepository } from './repositories/tenant-temporal-namespace.repository'

const logger = createLogger('pegasus-temporal-provisioner')
const secretsManager = new SecretsManagerClient({})

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

async function provisionerApiKey(): Promise<string> {
  const out = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: requireEnv('TEMPORAL_PROVISIONER_SECRET_ARN') }),
  )
  const parsed: unknown = JSON.parse(out.SecretString ?? '{}')
  const apiKey = (parsed as { apiKey?: unknown }).apiKey
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('provisioner secret has no apiKey field')
  }
  return apiKey
}

/** gRPC DescribeNamespace with the tenant's own key: true once it's authorized. */
async function checkReady(target: {
  namespace: string
  grpcAddress: string
  apiKey: string
}): Promise<boolean> {
  const connection = await Connection.connect({
    address: target.grpcAddress,
    tls: true,
    apiKey: target.apiKey,
    metadata: { 'temporal-namespace': target.namespace },
    connectTimeout: 10_000,
  })
  try {
    await connection.workflowService.describeNamespace({ namespace: target.namespace })
    return true
  } finally {
    await connection.close()
  }
}

function isProvisionerEvent(event: unknown): event is ProvisionerEvent {
  if (typeof event !== 'object' || event === null) return false
  const e = event as Record<string, unknown>
  if (e['action'] === 'retire-previous-keys') return true
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
  const cloud = createTemporalCloudOpsClient({
    apiKey: await provisionerApiKey(),
    env: requireEnv('ENV_NAME'),
    logger,
  })
  return runTemporalProvisioner(event, {
    repo: createTenantTemporalNamespaceRepository(db),
    cloud,
    env: requireEnv('ENV_NAME'),
    checkReady,
    logger,
  })
}
