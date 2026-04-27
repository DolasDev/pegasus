// ---------------------------------------------------------------------------
// Pegasus VPN hub reconcile agent.
//
// Lifecycle (runs forever under systemd — pegasus-vpn-agent.service):
//   1. Every TICK_SECS, GET /api/vpn/peers with If-None-Match: <last-etag>.
//   2. On 200, diff against `wg show wg0 dump` → apply `wg set` commands.
//   3. PATCH /api/vpn/peers/:id for observed peers to report handshake age
//      and byte counters, and to promote PENDING → ACTIVE once seen.
//   4. Emit CloudWatch metrics (HubReconcileLagSeconds, HandshakeAgeMaxSeconds,
//      ActivePeers, AgentHeartbeat, optionally HubEipAssociated).
//
// Environment:
//   ADMIN_API_URL              — e.g. https://api.pegasusapp.com
//   AGENT_API_KEY              — vnd_<48 hex> with scope vpn:sync
//   AWS_REGION                 — for the CloudWatch client (default us-east-1)
//   TICK_SECS                  — default 30
//   DRY_RUN                    — "true" logs wg commands instead of executing them
//   LOG_LEVEL                  — info | debug (default info)
//   HUB_EIP_ALLOCATION_ID      — optional; enables the HubEipAssociated metric
//   HUB_INSTANCE_ID            — optional; required when HUB_EIP_ALLOCATION_ID is set
// ---------------------------------------------------------------------------

import {
  CloudWatchClient,
  PutMetricDataCommand,
  type MetricDatum,
} from '@aws-sdk/client-cloudwatch'
import { EC2Client, DescribeAddressesCommand } from '@aws-sdk/client-ec2'
import { createAgentApi, type AgentApi } from './api-client'
import { createWgExec, type WgExec } from './wg-exec'
import { diffState, type DesiredPeer } from './reconciler'

const METRIC_NAMESPACE = 'PegasusWireGuard'

interface AgentConfig {
  adminApiUrl: string
  agentApiKey: string
  region: string
  tickSecs: number
  dryRun: boolean
  debug: boolean
  /** When set together, the agent emits HubEipAssociated each tick. */
  hubEipAllocationId: string | null
  hubInstanceId: string | null
}

function readConfig(): AgentConfig {
  const required = (key: string): string => {
    const v = process.env[key]
    if (!v) throw new Error(`${key} env var is required`)
    return v
  }
  const hubEipAllocationId = process.env['HUB_EIP_ALLOCATION_ID'] ?? null
  const hubInstanceId = process.env['HUB_INSTANCE_ID'] ?? null
  return {
    adminApiUrl: required('ADMIN_API_URL'),
    agentApiKey: required('AGENT_API_KEY'),
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    tickSecs: Number(process.env['TICK_SECS'] ?? '30'),
    dryRun: process.env['DRY_RUN'] === 'true',
    debug: process.env['LOG_LEVEL'] === 'debug',
    hubEipAllocationId: hubEipAllocationId && hubInstanceId ? hubEipAllocationId : null,
    hubInstanceId: hubEipAllocationId && hubInstanceId ? hubInstanceId : null,
  }
}

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...fields,
    }),
  )
}

interface TickDeps {
  api: AgentApi
  wg: WgExec
  cw: CloudWatchClient | null
  state: MutableState
  /**
   * Optional. When provided, the agent verifies the hub EIP is still
   * associated with this instance each tick and emits HubEipAssociated.
   */
  eipCheck?: EipCheck | null
}

/** Pluggable EIP-association check — exposed for tests. */
export interface EipCheck {
  /** Returns 1 if the EIP is associated with the expected instance, 0 otherwise. */
  isAssociated(): Promise<0 | 1>
}

interface MutableState {
  lastEtag: string | null
  lastDesired: DesiredPeer[]
  lastReconcileMs: number
}

export async function runTick(deps: TickDeps): Promise<void> {
  const { api, wg, state } = deps
  const started = Date.now()
  const correlationId = crypto.randomUUID()

  const feed = await api.getPeers(state.lastEtag)
  if (feed.etag) state.lastEtag = feed.etag
  if (feed.peers !== null) state.lastDesired = feed.peers

  const dump = await wg.showDump()
  const diff = diffState(state.lastDesired, dump.peers)

  if (diff.add.length > 0 || diff.remove.length > 0) {
    log('reconcile.diff', {
      correlationId,
      adds: diff.add.length,
      removes: diff.remove.length,
      generation: feed.generation,
    })
  }

  for (const p of diff.add) {
    try {
      await wg.addPeer(p.publicKey, p.allowedIps)
      log('peer.added', { correlationId, tenantId: p.tenantId, publicKey: p.publicKey })
    } catch (err) {
      log('peer.add_failed', { correlationId, tenantId: p.tenantId, error: String(err) })
    }
  }

  for (const key of diff.remove) {
    try {
      await wg.removePeer(key)
      log('peer.removed', { correlationId, publicKey: key })
    } catch (err) {
      log('peer.remove_failed', { correlationId, publicKey: key, error: String(err) })
    }
  }

  // Telemetry for observed peers.
  let handshakeAgeMaxSec = 0
  for (const { desired: d, kernel: k } of diff.observed) {
    try {
      const promoteToActive = d.status === 'PENDING' && k.lastHandshakeAt !== null
      await api.patchPeer(d.id, {
        ...(promoteToActive ? { status: 'ACTIVE' as const } : {}),
        lastHandshakeAt: k.lastHandshakeAt?.toISOString() ?? null,
        rxBytes: k.rxBytes.toString(),
        txBytes: k.txBytes.toString(),
      })
    } catch (err) {
      log('peer.patch_failed', { correlationId, id: d.id, error: String(err) })
    }

    if (k.lastHandshakeAt) {
      const ageSec = Math.max(0, Math.floor((Date.now() - k.lastHandshakeAt.getTime()) / 1000))
      handshakeAgeMaxSec = Math.max(handshakeAgeMaxSec, ageSec)
    }
  }

  state.lastReconcileMs = Date.now()

  const reconcileMs = Date.now() - started
  log('reconcile.done', {
    correlationId,
    durationMs: reconcileMs,
    desired: state.lastDesired.length,
    observed: dump.peers.length,
    generation: feed.generation,
  })

  let eipAssociated: 0 | 1 | null = null
  if (deps.eipCheck) {
    try {
      eipAssociated = await deps.eipCheck.isAssociated()
    } catch (err) {
      log('eip.check_failed', { error: String(err) })
      eipAssociated = 0
    }
  }

  if (deps.cw) {
    await emitMetrics(deps.cw, {
      reconcileLagSec: Math.max(0, Math.floor((Date.now() - state.lastReconcileMs) / 1000)),
      reconcileDurationMs: reconcileMs,
      handshakeAgeMaxSec,
      activePeers: state.lastDesired.filter((p) => p.status === 'ACTIVE').length,
      pendingPeers: state.lastDesired.filter((p) => p.status === 'PENDING').length,
      kernelPeers: dump.peers.length,
      eipAssociated,
    })
  }
}

interface Metrics {
  reconcileLagSec: number
  reconcileDurationMs: number
  handshakeAgeMaxSec: number
  activePeers: number
  pendingPeers: number
  kernelPeers: number
  /** null when the EIP check is disabled (e.g. local dev or missing env vars). */
  eipAssociated: 0 | 1 | null
}

async function emitMetrics(cw: CloudWatchClient, m: Metrics): Promise<void> {
  const ts = new Date()
  const data: MetricDatum[] = [
    {
      MetricName: 'HubReconcileLagSeconds',
      Value: m.reconcileLagSec,
      Unit: 'Seconds',
      Timestamp: ts,
    },
    {
      MetricName: 'AgentReconcileDurationMs',
      Value: m.reconcileDurationMs,
      Unit: 'Milliseconds',
      Timestamp: ts,
    },
    {
      MetricName: 'HandshakeAgeMaxSeconds',
      Value: m.handshakeAgeMaxSec,
      Unit: 'Seconds',
      Timestamp: ts,
    },
    { MetricName: 'ActivePeers', Value: m.activePeers, Unit: 'Count', Timestamp: ts },
    { MetricName: 'PendingPeers', Value: m.pendingPeers, Unit: 'Count', Timestamp: ts },
    { MetricName: 'KernelPeers', Value: m.kernelPeers, Unit: 'Count', Timestamp: ts },
    // Liveness: a constant 1 every tick. CloudWatch's "missing data" treatment
    // turns absent ticks into the alarm condition - simpler than tracking
    // per-instance health from outside the process.
    { MetricName: 'AgentHeartbeat', Value: 1, Unit: 'Count', Timestamp: ts },
  ]
  if (m.eipAssociated !== null) {
    data.push({
      MetricName: 'HubEipAssociated',
      Value: m.eipAssociated,
      Unit: 'Count',
      Timestamp: ts,
    })
  }
  try {
    await cw.send(new PutMetricDataCommand({ Namespace: METRIC_NAMESPACE, MetricData: data }))
  } catch (err) {
    log('metrics.publish_failed', { error: String(err) })
  }
}

function createEc2EipCheck(args: {
  region: string
  allocationId: string
  expectedInstanceId: string
}): EipCheck {
  const ec2 = new EC2Client({ region: args.region })
  return {
    async isAssociated() {
      const res = await ec2.send(
        new DescribeAddressesCommand({ AllocationIds: [args.allocationId] }),
      )
      const entry = res.Addresses?.[0]
      return entry?.InstanceId === args.expectedInstanceId ? 1 : 0
    },
  }
}

async function main(): Promise<void> {
  const config = readConfig()
  log('agent.starting', {
    adminApiUrl: config.adminApiUrl,
    tickSecs: config.tickSecs,
    dryRun: config.dryRun,
  })

  const api = createAgentApi({
    baseUrl: config.adminApiUrl,
    apiKey: config.agentApiKey,
  })
  const wg = createWgExec({ dryRun: config.dryRun })
  const cw = config.dryRun ? null : new CloudWatchClient({ region: config.region })
  const eipCheck =
    !config.dryRun && config.hubEipAllocationId && config.hubInstanceId
      ? createEc2EipCheck({
          region: config.region,
          allocationId: config.hubEipAllocationId,
          expectedInstanceId: config.hubInstanceId,
        })
      : null

  const state: MutableState = {
    lastEtag: null,
    lastDesired: [],
    lastReconcileMs: Date.now(),
  }

  // Run once immediately so the first handshake is picked up promptly.
  await runTickCatching({ api, wg, cw, state, eipCheck })

  setInterval(() => {
    void runTickCatching({ api, wg, cw, state, eipCheck })
  }, config.tickSecs * 1000)
}

async function runTickCatching(deps: TickDeps): Promise<void> {
  try {
    await runTick(deps)
  } catch (err) {
    log('reconcile.failed', { error: String(err), stack: (err as Error).stack })
  }
}

// Run only when executed directly — the tests import `runTick` without
// triggering main(). `PEGASUS_VPN_AGENT_START=1` is set by the systemd
// ExecStart wrapper so the agent boots in production.
if (process.env['PEGASUS_VPN_AGENT_START'] === '1') {
  void main()
}
