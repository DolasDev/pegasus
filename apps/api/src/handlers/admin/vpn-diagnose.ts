// ---------------------------------------------------------------------------
// Admin VPN diagnose handler — GET /api/admin/tenants/:tenantId/vpn/diagnose
//
// Runs a layered set of checks against the cloud → hub → tenant data path
// and returns a structured pass/fail report. Designed to short-circuit the
// kind of "where in this 5-hop chain is traffic dying" debugging session
// that costs hours of SSM dives and tcpdump captures. Each check maps to a
// specific layer; the ordered list below tells operators which link is the
// first to fail.
//
// Auth: inherited from adminAuthMiddleware on the parent router (PLATFORM_
// ADMIN Cognito JWT required). Uses basePrisma — never the tenant-scoped
// extension.
//
// Latency: ~10–30 s end-to-end depending on whether the SSM-on-hub checks
// fire (each SSM round-trip is ~5–8 s). It's an admin endpoint, not a hot
// path; the latency tradeoff is for the diagnostic depth.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeInstanceAttributeCommand,
  DescribeSecurityGroupsCommand,
  DescribeRouteTablesCommand,
} from '@aws-sdk/client-ec2'
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm'
import type { AdminEnv } from '../../types'
import { db } from '../../db'
import { tunnelFetch, TunnelError } from '../../lib/tunnel-client'
import { logger } from '../../lib/logger'

// Discovery constants — coupled to CDK definitions in
// packages/infra/lib/stacks/wireguard-stack.ts. Update both together.
const HUB_INSTANCE_NAME_TAG = 'pegasus-wireguard-hub'
const HUB_SG_NAME = 'pegasus-wireguard-hub'
const TUNNEL_PROXY_SG_NAME = 'pegasus-wireguard-tunnel-proxy'
const LAMBDA_SUBNET_TAG_KEY = 'pegasus:subnet-role'
const LAMBDA_SUBNET_TAG_VALUE = 'private-lambda'
const TENANT_OVERLAY_CIDR = '10.200.0.0/16'
const TENANT_OVERLAY_PORT = 3000

export type CheckStatus = 'pass' | 'fail' | 'skip'

export interface DiagnoseCheck {
  id: string
  label: string
  status: CheckStatus
  detail: string
  evidence?: Record<string, unknown>
  elapsedMs: number
}

export interface DiagnoseReport {
  tenantId: string
  summary: 'pass' | 'fail'
  firstFailure: string | null
  checks: DiagnoseCheck[]
}

// AWS SDK clients are module-level so tests can swap them via setters.
let _ec2: EC2Client | null = null
let _ssm: SSMClient | null = null
function getEc2(): EC2Client {
  if (_ec2 === null) _ec2 = new EC2Client({})
  return _ec2
}
function getSsm(): SSMClient {
  if (_ssm === null) _ssm = new SSMClient({})
  return _ssm
}
export function setVpnDiagnoseClients(clients: {
  ec2?: EC2Client | null
  ssm?: SSMClient | null
}): void {
  if (clients.ec2 !== undefined) _ec2 = clients.ec2
  if (clients.ssm !== undefined) _ssm = clients.ssm
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; elapsedMs: number }> {
  const start = Date.now()
  const value = await fn()
  return { value, elapsedMs: Date.now() - start }
}

function pass(
  id: string,
  label: string,
  detail: string,
  elapsedMs: number,
  evidence?: Record<string, unknown>,
): DiagnoseCheck {
  return evidence !== undefined
    ? { id, label, status: 'pass', detail, evidence, elapsedMs }
    : { id, label, status: 'pass', detail, elapsedMs }
}
function fail(
  id: string,
  label: string,
  detail: string,
  elapsedMs: number,
  evidence?: Record<string, unknown>,
): DiagnoseCheck {
  return evidence !== undefined
    ? { id, label, status: 'fail', detail, evidence, elapsedMs }
    : { id, label, status: 'fail', detail, elapsedMs }
}
function skip(id: string, label: string, detail: string): DiagnoseCheck {
  return { id, label, status: 'skip', detail, elapsedMs: 0 }
}

// ---------------------------------------------------------------------------
// Individual check implementations.
//
// Each returns a DiagnoseCheck. They're invoked in order so a downstream
// check can early-skip when a prerequisite fails (e.g. no hub instance
// → can't run SSM checks). The `firstFailure` field on the report points
// at the first failing check, since that's almost always the root cause.
// ---------------------------------------------------------------------------

async function checkVpnPeer(
  tenantId: string,
): Promise<{ check: DiagnoseCheck; overlayIp: string | null }> {
  const { value: peer, elapsedMs } = await timed(() =>
    db.vpnPeer.findUnique({
      where: { tenantId },
      select: { assignedOctet1: true, assignedOctet2: true, status: true, publicKey: true },
    }),
  )
  if (!peer) {
    return {
      check: fail(
        'vpn_peer',
        'VPN peer record exists',
        `No VpnPeer row for tenant ${tenantId}. Run admin VPN provisioning.`,
        elapsedMs,
      ),
      overlayIp: null,
    }
  }
  if (peer.status !== 'ACTIVE') {
    return {
      check: fail(
        'vpn_peer',
        'VPN peer record exists',
        `VpnPeer.status is ${peer.status}, not ACTIVE.`,
        elapsedMs,
        { status: peer.status },
      ),
      overlayIp: null,
    }
  }
  const overlayIp = `10.200.${peer.assignedOctet1}.${peer.assignedOctet2}`
  return {
    check: pass(
      'vpn_peer',
      'VPN peer record exists',
      `Peer is ACTIVE at ${overlayIp}.`,
      elapsedMs,
      { overlayIp, status: peer.status },
    ),
    overlayIp,
  }
}

async function checkTenantMssql(tenantId: string): Promise<DiagnoseCheck> {
  const { value: tenant, elapsedMs } = await timed(() =>
    db.tenant.findUnique({ where: { id: tenantId }, select: { mssqlConnectionString: true } }),
  )
  if (!tenant?.mssqlConnectionString) {
    return fail(
      'tenant_mssql',
      'Tenant MSSQL connection string set',
      'tenant.mssqlConnectionString is empty — /version will 422 even if connectivity works.',
      elapsedMs,
    )
  }
  return pass(
    'tenant_mssql',
    'Tenant MSSQL connection string set',
    'Connection string present.',
    elapsedMs,
  )
}

async function checkHubInstance(): Promise<{ check: DiagnoseCheck; instanceId: string | null }> {
  const { value, elapsedMs } = await timed(() =>
    getEc2().send(
      new DescribeInstancesCommand({
        Filters: [
          { Name: 'tag:Name', Values: [HUB_INSTANCE_NAME_TAG] },
          { Name: 'instance-state-name', Values: ['running'] },
        ],
      }),
    ),
  )
  const instances = value.Reservations?.flatMap((r) => r.Instances ?? []) ?? []
  if (instances.length === 0) {
    return {
      check: fail(
        'hub_instance',
        'WireGuard hub instance is running',
        `No running EC2 instance found with Name tag '${HUB_INSTANCE_NAME_TAG}'.`,
        elapsedMs,
      ),
      instanceId: null,
    }
  }
  const inst = instances[0]!
  return {
    check: pass(
      'hub_instance',
      'WireGuard hub instance is running',
      `Instance ${inst.InstanceId} is running in ${inst.Placement?.AvailabilityZone}.`,
      elapsedMs,
      { instanceId: inst.InstanceId, az: inst.Placement?.AvailabilityZone },
    ),
    instanceId: inst.InstanceId ?? null,
  }
}

async function checkHubSrcDstCheck(instanceId: string): Promise<DiagnoseCheck> {
  const { value, elapsedMs } = await timed(() =>
    getEc2().send(
      new DescribeInstanceAttributeCommand({
        InstanceId: instanceId,
        Attribute: 'sourceDestCheck',
      }),
    ),
  )
  const enabled = value.SourceDestCheck?.Value === true
  if (enabled) {
    return fail(
      'hub_src_dst_check',
      'Hub source/destination check disabled',
      'sourceDestCheck=true on the hub. AWS drops forwarded packets at the ENI.',
      elapsedMs,
    )
  }
  return pass(
    'hub_src_dst_check',
    'Hub source/destination check disabled',
    'sourceDestCheck=false (forwarding allowed).',
    elapsedMs,
  )
}

async function checkHubSecurityGroup(): Promise<DiagnoseCheck> {
  const { value, elapsedMs } = await timed(() =>
    getEc2().send(
      new DescribeSecurityGroupsCommand({
        Filters: [{ Name: 'group-name', Values: [HUB_SG_NAME] }],
      }),
    ),
  )
  const sg = value.SecurityGroups?.[0]
  if (!sg) {
    return fail(
      'hub_security_group',
      'Hub SG accepts inbound from tunnel-proxy SG',
      `No security group named '${HUB_SG_NAME}' found.`,
      elapsedMs,
    )
  }
  // Look up the proxy SG's GroupId so we can compare by ID (not name).
  const proxyResp = await getEc2().send(
    new DescribeSecurityGroupsCommand({
      Filters: [{ Name: 'group-name', Values: [TUNNEL_PROXY_SG_NAME] }],
    }),
  )
  const proxySgId = proxyResp.SecurityGroups?.[0]?.GroupId
  if (!proxySgId) {
    return fail(
      'hub_security_group',
      'Hub SG accepts inbound from tunnel-proxy SG',
      `No security group named '${TUNNEL_PROXY_SG_NAME}' found.`,
      elapsedMs,
    )
  }
  const allowsProxy = (sg.IpPermissions ?? []).some((p) =>
    (p.UserIdGroupPairs ?? []).some((pair) => pair.GroupId === proxySgId),
  )
  if (!allowsProxy) {
    return fail(
      'hub_security_group',
      'Hub SG accepts inbound from tunnel-proxy SG',
      `Hub SG (${sg.GroupId}) has no inbound rule allowing tunnel-proxy SG (${proxySgId}). All Lambda traffic dropped at hub ENI.`,
      elapsedMs,
      { hubSgId: sg.GroupId, proxySgId },
    )
  }
  return pass(
    'hub_security_group',
    'Hub SG accepts inbound from tunnel-proxy SG',
    `Hub SG ${sg.GroupId} allows inbound from tunnel-proxy SG ${proxySgId}.`,
    elapsedMs,
  )
}

async function checkVpcRouteTable(hubInstanceId: string): Promise<DiagnoseCheck> {
  const { value, elapsedMs } = await timed(() =>
    getEc2().send(
      new DescribeRouteTablesCommand({
        Filters: [{ Name: `tag:${LAMBDA_SUBNET_TAG_KEY}`, Values: [LAMBDA_SUBNET_TAG_VALUE] }],
      }),
    ),
  )
  const rts = value.RouteTables ?? []
  if (rts.length === 0) {
    return fail(
      'vpc_route_table',
      'Lambda subnet route table forwards overlay CIDR to hub',
      `No route tables found with tag ${LAMBDA_SUBNET_TAG_KEY}=${LAMBDA_SUBNET_TAG_VALUE}.`,
      elapsedMs,
    )
  }
  const missing: string[] = []
  for (const rt of rts) {
    const overlayRoute = (rt.Routes ?? []).find(
      (r) => r.DestinationCidrBlock === TENANT_OVERLAY_CIDR,
    )
    if (!overlayRoute || overlayRoute.InstanceId !== hubInstanceId) {
      missing.push(rt.RouteTableId ?? '<unknown>')
    }
  }
  if (missing.length > 0) {
    return fail(
      'vpc_route_table',
      'Lambda subnet route table forwards overlay CIDR to hub',
      `${TENANT_OVERLAY_CIDR} not routed to hub instance on route tables: ${missing.join(', ')}. Hub userdata's create-route loop may have failed.`,
      elapsedMs,
      { missing },
    )
  }
  return pass(
    'vpc_route_table',
    'Lambda subnet route table forwards overlay CIDR to hub',
    `${rts.length} route table(s) correctly forward ${TENANT_OVERLAY_CIDR} to ${hubInstanceId}.`,
    elapsedMs,
  )
}

// ---------------------------------------------------------------------------
// SSM-on-hub checks. Each runs a single shell command on the hub and
// inspects the output. SSM round-trip ~5–8 s; we await sequentially since
// they share the same hub and overall latency is dominated by the polling.
// ---------------------------------------------------------------------------

async function runOnHub(
  instanceId: string,
  command: string,
): Promise<{ exitCode: number; stdout: string; stderr: string; elapsedMs: number }> {
  const start = Date.now()
  const send = await getSsm().send(
    new SendCommandCommand({
      InstanceIds: [instanceId],
      DocumentName: 'AWS-RunShellScript',
      Parameters: { commands: [command] },
    }),
  )
  const cmdId = send.Command?.CommandId
  if (!cmdId) {
    return {
      exitCode: -1,
      stdout: '',
      stderr: 'SendCommand returned no CommandId',
      elapsedMs: Date.now() - start,
    }
  }
  // Poll up to ~15s. SSM's eventual consistency means GetCommandInvocation
  // can return InvocationDoesNotExist briefly after SendCommand.
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 0 ? 1500 : 1500))
    try {
      const inv = await getSsm().send(
        new GetCommandInvocationCommand({ CommandId: cmdId, InstanceId: instanceId }),
      )
      if (inv.Status === 'InProgress' || inv.Status === 'Pending') continue
      return {
        exitCode: inv.ResponseCode ?? -1,
        stdout: inv.StandardOutputContent ?? '',
        stderr: inv.StandardErrorContent ?? '',
        elapsedMs: Date.now() - start,
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'InvocationDoesNotExist') continue
      throw err
    }
  }
  return {
    exitCode: -1,
    stdout: '',
    stderr: 'Timed out waiting for SSM invocation',
    elapsedMs: Date.now() - start,
  }
}

async function checkHubKernelRoute(instanceId: string): Promise<DiagnoseCheck> {
  const { exitCode, stdout, elapsedMs } = await runOnHub(
    instanceId,
    `ip route show ${TENANT_OVERLAY_CIDR}`,
  )
  if (exitCode !== 0 || !stdout.includes('wg0')) {
    return fail(
      'hub_kernel_route',
      'Hub kernel route 10.200.0.0/16 dev wg0',
      `Route missing or not on wg0. Output: ${stdout.trim() || '(empty)'}. wg0.conf PostUp may not have run.`,
      elapsedMs,
    )
  }
  return pass(
    'hub_kernel_route',
    'Hub kernel route 10.200.0.0/16 dev wg0',
    `Route present: ${stdout.trim()}`,
    elapsedMs,
  )
}

async function checkHubMasquerade(instanceId: string): Promise<DiagnoseCheck> {
  const { exitCode, stdout, stderr, elapsedMs } = await runOnHub(
    instanceId,
    'sudo iptables -t nat -C POSTROUTING -o wg0 -j MASQUERADE 2>&1',
  )
  if (exitCode !== 0) {
    return fail(
      'hub_masquerade',
      'Hub iptables MASQUERADE on wg0',
      `MASQUERADE rule missing. Forwarded Lambda traffic will be dropped at tenant AllowedIPs check. Output: ${stdout.trim() || stderr.trim() || '(empty)'}`,
      elapsedMs,
    )
  }
  return pass(
    'hub_masquerade',
    'Hub iptables MASQUERADE on wg0',
    'POSTROUTING -o wg0 -j MASQUERADE present.',
    elapsedMs,
  )
}

async function checkHubWgHandshake(instanceId: string, overlayIp: string): Promise<DiagnoseCheck> {
  const { exitCode, stdout, elapsedMs } = await runOnHub(instanceId, 'sudo wg show wg0')
  if (exitCode !== 0) {
    return fail(
      'hub_wg_handshake',
      'WG handshake fresh for tenant peer',
      `wg show failed (exit ${exitCode}).`,
      elapsedMs,
    )
  }
  // Find the peer block whose allowed-ips matches our tenant overlay IP.
  const lines = stdout.split('\n')
  let inPeer = false
  let allowedIpsMatch = false
  let handshakeLine: string | null = null
  for (const line of lines) {
    if (line.startsWith('peer:')) {
      inPeer = true
      allowedIpsMatch = false
      handshakeLine = null
    } else if (inPeer) {
      if (line.includes('allowed ips:') && line.includes(`${overlayIp}/32`)) {
        allowedIpsMatch = true
      } else if (line.includes('latest handshake:')) {
        handshakeLine = line.trim()
      }
    }
    if (allowedIpsMatch && handshakeLine !== null) break
  }
  if (!allowedIpsMatch) {
    return fail(
      'hub_wg_handshake',
      'WG handshake fresh for tenant peer',
      `No WG peer with allowed-ips ${overlayIp}/32 on hub. Tenant client.conf may not have been imported.`,
      elapsedMs,
    )
  }
  if (handshakeLine === null) {
    return fail(
      'hub_wg_handshake',
      'WG handshake fresh for tenant peer',
      'Tenant peer registered but no handshake yet — on-prem WG client may be down or unreachable.',
      elapsedMs,
    )
  }
  return pass('hub_wg_handshake', 'WG handshake fresh for tenant peer', handshakeLine, elapsedMs)
}

async function checkTcpConnect(overlayIp: string): Promise<DiagnoseCheck> {
  const start = Date.now()
  try {
    // Using tunnelFetch as the "TCP probe" — it hits the same network path
    // the production traffic uses, so a clean fail here reproduces what
    // the user sees. 5s timeout to keep the diagnostic snappy.
    const url = `http://${overlayIp}:${TENANT_OVERLAY_PORT}/api/v1/longhaul/version`
    const res = await tunnelFetch(url, { method: 'GET', timeoutMs: 5000 })
    const elapsedMs = Date.now() - start
    if (res.status >= 200 && res.status < 300) {
      return pass(
        'tcp_connect',
        'Cloud → on-prem TCP connect on overlay :3000',
        `HTTP ${res.status} from on-prem service.`,
        elapsedMs,
        { httpStatus: res.status },
      )
    }
    if (res.status === 403) {
      // 403 means we reached the on-prem service but failed an auth check.
      // That's a connectivity success — flag it as pass with an explanatory
      // note since it's a different layer (longhaul user middleware).
      return pass(
        'tcp_connect',
        'Cloud → on-prem TCP connect on overlay :3000',
        `HTTP 403 from on-prem service — connectivity OK; longhaul auth middleware rejected (expected when X-Windows-User absent).`,
        elapsedMs,
        { httpStatus: res.status },
      )
    }
    return fail(
      'tcp_connect',
      'Cloud → on-prem TCP connect on overlay :3000',
      `HTTP ${res.status} from on-prem service. Body (truncated): ${res.body.slice(0, 200)}`,
      elapsedMs,
      { httpStatus: res.status },
    )
  } catch (err) {
    const elapsedMs = Date.now() - start
    if (err instanceof TunnelError) {
      return fail(
        'tcp_connect',
        'Cloud → on-prem TCP connect on overlay :3000',
        `${err.code}: ${err.message}`,
        elapsedMs,
      )
    }
    return fail(
      'tcp_connect',
      'Cloud → on-prem TCP connect on overlay :3000',
      err instanceof Error ? err.message : String(err),
      elapsedMs,
    )
  }
}

// ---------------------------------------------------------------------------
// Router + handler
// ---------------------------------------------------------------------------

export const adminVpnDiagnoseRouter = new Hono<AdminEnv>()

adminVpnDiagnoseRouter.get('/diagnose', async (c) => {
  const tenantId = c.req.param('tenantId')!
  const checks: DiagnoseCheck[] = []

  // Layer 0: data
  const peerResult = await checkVpnPeer(tenantId)
  checks.push(peerResult.check)
  checks.push(await checkTenantMssql(tenantId))

  // Layer 1: AWS network plane
  const hubResult = await checkHubInstance()
  checks.push(hubResult.check)
  if (hubResult.instanceId !== null) {
    checks.push(await checkHubSrcDstCheck(hubResult.instanceId))
    checks.push(await checkVpcRouteTable(hubResult.instanceId))
  } else {
    checks.push(
      skip(
        'hub_src_dst_check',
        'Hub source/destination check disabled',
        'No hub instance to query.',
      ),
    )
    checks.push(
      skip(
        'vpc_route_table',
        'Lambda subnet route table forwards overlay CIDR to hub',
        'No hub instance to compare against.',
      ),
    )
  }
  checks.push(await checkHubSecurityGroup())

  // Layer 2: hub kernel state (SSM)
  if (hubResult.instanceId !== null) {
    checks.push(await checkHubKernelRoute(hubResult.instanceId))
    checks.push(await checkHubMasquerade(hubResult.instanceId))
    if (peerResult.overlayIp !== null) {
      checks.push(await checkHubWgHandshake(hubResult.instanceId, peerResult.overlayIp))
    } else {
      checks.push(
        skip(
          'hub_wg_handshake',
          'WG handshake fresh for tenant peer',
          'No active VpnPeer to look for.',
        ),
      )
    }
  } else {
    checks.push(
      skip(
        'hub_kernel_route',
        'Hub kernel route 10.200.0.0/16 dev wg0',
        'No hub instance to query.',
      ),
    )
    checks.push(
      skip('hub_masquerade', 'Hub iptables MASQUERADE on wg0', 'No hub instance to query.'),
    )
    checks.push(
      skip('hub_wg_handshake', 'WG handshake fresh for tenant peer', 'No hub instance to query.'),
    )
  }

  // Layer 3: end-to-end TCP probe
  if (peerResult.overlayIp !== null) {
    checks.push(await checkTcpConnect(peerResult.overlayIp))
  } else {
    checks.push(
      skip(
        'tcp_connect',
        'Cloud → on-prem TCP connect on overlay :3000',
        'No active VpnPeer overlay IP to probe.',
      ),
    )
  }

  const firstFailure = checks.find((c) => c.status === 'fail')?.id ?? null
  const summary: DiagnoseReport['summary'] = firstFailure === null ? 'pass' : 'fail'
  const report: DiagnoseReport = { tenantId, summary, firstFailure, checks }
  if (summary === 'fail') {
    logger.warn('vpn diagnose failed', { tenantId, firstFailure })
  }
  return c.json({ data: report })
})
