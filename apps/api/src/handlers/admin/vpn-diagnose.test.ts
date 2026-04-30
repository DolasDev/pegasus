// ---------------------------------------------------------------------------
// Tests for admin VPN diagnose handler.
//
// db is mocked via vi.hoisted; AWS EC2/SSM clients are injected via the
// setVpnDiagnoseClients() seam exposed by the handler module. The
// tunnel-client is mocked so tcp_connect doesn't actually invoke Lambda.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { AdminEnv } from '../../types'
import {
  type EC2Client,
  DescribeInstancesCommand,
  DescribeInstanceAttributeCommand,
  DescribeSecurityGroupsCommand,
  DescribeRouteTablesCommand,
} from '@aws-sdk/client-ec2'
import {
  type SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand,
} from '@aws-sdk/client-ssm'

const { mockDb, mockTunnelFetch } = vi.hoisted(() => ({
  mockDb: {
    tenant: { findUnique: vi.fn() },
    vpnPeer: { findUnique: vi.fn() },
  },
  mockTunnelFetch: vi.fn(),
}))

vi.mock('../../db', () => ({ db: mockDb }))
import type * as TunnelClientModule from '../../lib/tunnel-client'
vi.mock('../../lib/tunnel-client', async (importOriginal) => {
  const actual = await importOriginal<typeof TunnelClientModule>()
  return { ...actual, tunnelFetch: mockTunnelFetch }
})

import { adminVpnDiagnoseRouter, setVpnDiagnoseClients, type DiagnoseReport } from './vpn-diagnose'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = new Hono<AdminEnv>()
  app.use('*', async (c, next) => {
    c.set('adminSub', 'admin-sub')
    c.set('adminEmail', 'admin@example.com')
    await next()
  })
  app.route('/tenants/:tenantId/vpn', adminVpnDiagnoseRouter)
  return app
}

async function getReport(app: Hono<AdminEnv>, tenantId = 'tnt_1'): Promise<DiagnoseReport> {
  const res = await app.request(`/tenants/${tenantId}/vpn/diagnose`)
  expect(res.status).toBe(200)
  const body = (await res.json()) as { data: DiagnoseReport }
  return body.data
}

// Build a fake EC2Client whose .send() dispatches based on command type.
type Ec2Handler = {
  describeInstances?: () => unknown
  describeInstanceAttribute?: () => unknown
  describeSecurityGroups?: (filters: { name: string | undefined }) => unknown
  describeRouteTables?: () => unknown
}

function fakeEc2(handlers: Ec2Handler): EC2Client {
  const send = vi.fn(async (cmd: unknown) => {
    if (cmd instanceof DescribeInstancesCommand) {
      return handlers.describeInstances?.() ?? { Reservations: [] }
    }
    if (cmd instanceof DescribeInstanceAttributeCommand) {
      return handlers.describeInstanceAttribute?.() ?? { SourceDestCheck: { Value: false } }
    }
    if (cmd instanceof DescribeSecurityGroupsCommand) {
      const filters = (cmd as DescribeSecurityGroupsCommand).input.Filters ?? []
      const nameFilter = filters.find((f) => f.Name === 'group-name')
      const groupName = nameFilter?.Values?.[0]
      return handlers.describeSecurityGroups?.({ name: groupName }) ?? { SecurityGroups: [] }
    }
    if (cmd instanceof DescribeRouteTablesCommand) {
      return handlers.describeRouteTables?.() ?? { RouteTables: [] }
    }
    throw new Error(`Unexpected EC2 command: ${cmd?.constructor?.name ?? 'unknown'}`)
  })
  return { send } as unknown as EC2Client
}

// SSM stub: SendCommand returns a fixed CommandId, GetCommandInvocation
// returns the canned output keyed by command text.
function fakeSsm(
  invocations: Record<string, { exitCode: number; stdout?: string; stderr?: string }>,
): SSMClient {
  let lastCommand = ''
  const send = vi.fn(async (cmd: unknown) => {
    if (cmd instanceof SendCommandCommand) {
      const c = cmd as SendCommandCommand
      lastCommand = (c.input.Parameters?.['commands'] ?? [])[0] ?? ''
      return { Command: { CommandId: 'cmd-1' } }
    }
    if (cmd instanceof GetCommandInvocationCommand) {
      const matchKey = Object.keys(invocations).find((k) => lastCommand.includes(k))
      const inv = matchKey
        ? invocations[matchKey]!
        : { exitCode: -1, stdout: '', stderr: 'no matching mock' }
      return {
        Status: 'Success',
        ResponseCode: inv.exitCode,
        StandardOutputContent: inv.stdout ?? '',
        StandardErrorContent: inv.stderr ?? '',
      }
    }
    throw new Error(`Unexpected SSM command: ${cmd?.constructor?.name ?? 'unknown'}`)
  })
  return { send } as unknown as SSMClient
}

// ---------------------------------------------------------------------------
// Default "everything works" fixtures
// ---------------------------------------------------------------------------

const FRESH_HANDSHAKE_OUTPUT = `interface: wg0
  public key: HUBKEY=
  listening port: 51820

peer: PEERKEY=
  endpoint: 73.44.18.218:65163
  allowed ips: 10.200.0.2/32
  latest handshake: 30 seconds ago
  transfer: 1 KiB received, 1 KiB sent
`

beforeEach(() => {
  vi.clearAllMocks()
  setVpnDiagnoseClients({ ec2: null, ssm: null }) // reset to defaults

  mockDb.vpnPeer.findUnique.mockResolvedValue({
    assignedOctet1: 0,
    assignedOctet2: 2,
    status: 'ACTIVE',
    publicKey: 'PEERKEY=',
  })
  mockDb.tenant.findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=...' })
  mockTunnelFetch.mockResolvedValue({
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: '{"data":{"version":"1.2.3"}}',
  })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/tenants/:tenantId/vpn/diagnose', () => {
  it('returns summary=pass when every layer is healthy', async () => {
    setVpnDiagnoseClients({
      ec2: fakeEc2({
        describeInstances: () => ({
          Reservations: [
            {
              Instances: [{ InstanceId: 'i-hub-1', Placement: { AvailabilityZone: 'us-east-1a' } }],
            },
          ],
        }),
        describeInstanceAttribute: () => ({ SourceDestCheck: { Value: false } }),
        describeSecurityGroups: ({ name }) => {
          if (name === 'pegasus-wireguard-hub') {
            return {
              SecurityGroups: [
                {
                  GroupId: 'sg-hub',
                  IpPermissions: [{ UserIdGroupPairs: [{ GroupId: 'sg-proxy' }] }],
                },
              ],
            }
          }
          return { SecurityGroups: [{ GroupId: 'sg-proxy' }] }
        },
        describeRouteTables: () => ({
          RouteTables: [
            {
              RouteTableId: 'rtb-1',
              Routes: [{ DestinationCidrBlock: '10.200.0.0/16', InstanceId: 'i-hub-1' }],
            },
          ],
        }),
      }),
      ssm: fakeSsm({
        'ip route show 10.200.0.0/16': {
          exitCode: 0,
          stdout: '10.200.0.0/16 dev wg0 scope link\n',
        },
        'iptables -t nat -C POSTROUTING -o wg0 -j MASQUERADE': { exitCode: 0 },
        'wg show wg0': { exitCode: 0, stdout: FRESH_HANDSHAKE_OUTPUT },
      }),
    })

    const report = await getReport(buildApp())
    expect(report.summary).toBe('pass')
    expect(report.firstFailure).toBeNull()
    expect(report.checks.map((c) => c.id)).toEqual([
      'vpn_peer',
      'tenant_mssql',
      'hub_instance',
      'hub_src_dst_check',
      'vpc_route_table',
      'hub_security_group',
      'hub_kernel_route',
      'hub_masquerade',
      'hub_wg_handshake',
      'tcp_connect',
    ])
    expect(report.checks.every((c) => c.status === 'pass')).toBe(true)
  })

  it('flags missing VPN peer with first_failure=vpn_peer', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue(null)
    setVpnDiagnoseClients({ ec2: fakeEc2({}), ssm: fakeSsm({}) })

    const report = await getReport(buildApp())
    expect(report.summary).toBe('fail')
    expect(report.firstFailure).toBe('vpn_peer')
  })

  it('detects missing hub SG ingress from tunnel-proxy SG', async () => {
    setVpnDiagnoseClients({
      ec2: fakeEc2({
        describeInstances: () => ({
          Reservations: [{ Instances: [{ InstanceId: 'i-hub-1' }] }],
        }),
        describeInstanceAttribute: () => ({ SourceDestCheck: { Value: false } }),
        describeSecurityGroups: ({ name }) => {
          if (name === 'pegasus-wireguard-hub') {
            return {
              SecurityGroups: [
                {
                  GroupId: 'sg-hub',
                  IpPermissions: [
                    /* no UserIdGroupPairs */
                  ],
                },
              ],
            }
          }
          return { SecurityGroups: [{ GroupId: 'sg-proxy' }] }
        },
        describeRouteTables: () => ({
          RouteTables: [
            {
              RouteTableId: 'rtb-1',
              Routes: [{ DestinationCidrBlock: '10.200.0.0/16', InstanceId: 'i-hub-1' }],
            },
          ],
        }),
      }),
      ssm: fakeSsm({
        'ip route show 10.200.0.0/16': { exitCode: 0, stdout: '10.200.0.0/16 dev wg0\n' },
        'iptables -t nat -C POSTROUTING -o wg0 -j MASQUERADE': { exitCode: 0 },
        'wg show wg0': { exitCode: 0, stdout: FRESH_HANDSHAKE_OUTPUT },
      }),
    })
    const report = await getReport(buildApp())
    expect(report.summary).toBe('fail')
    expect(report.firstFailure).toBe('hub_security_group')
    const sgCheck = report.checks.find((c) => c.id === 'hub_security_group')!
    expect(sgCheck.detail).toContain('no inbound rule')
  })

  it('detects missing MASQUERADE rule via SSM', async () => {
    setVpnDiagnoseClients({
      ec2: fakeEc2({
        describeInstances: () => ({
          Reservations: [{ Instances: [{ InstanceId: 'i-hub-1' }] }],
        }),
        describeInstanceAttribute: () => ({ SourceDestCheck: { Value: false } }),
        describeSecurityGroups: ({ name }) => {
          if (name === 'pegasus-wireguard-hub') {
            return {
              SecurityGroups: [
                {
                  GroupId: 'sg-hub',
                  IpPermissions: [{ UserIdGroupPairs: [{ GroupId: 'sg-proxy' }] }],
                },
              ],
            }
          }
          return { SecurityGroups: [{ GroupId: 'sg-proxy' }] }
        },
        describeRouteTables: () => ({
          RouteTables: [
            {
              RouteTableId: 'rtb-1',
              Routes: [{ DestinationCidrBlock: '10.200.0.0/16', InstanceId: 'i-hub-1' }],
            },
          ],
        }),
      }),
      ssm: fakeSsm({
        'ip route show 10.200.0.0/16': { exitCode: 0, stdout: '10.200.0.0/16 dev wg0\n' },
        // exit non-zero → rule missing
        'iptables -t nat -C POSTROUTING -o wg0 -j MASQUERADE': {
          exitCode: 1,
          stdout: '',
          stderr: 'iptables: Bad rule',
        },
        'wg show wg0': { exitCode: 0, stdout: FRESH_HANDSHAKE_OUTPUT },
      }),
    })
    const report = await getReport(buildApp())
    expect(report.summary).toBe('fail')
    expect(report.firstFailure).toBe('hub_masquerade')
  })

  it('treats 403 from on-prem as a connectivity-OK pass with note', async () => {
    setVpnDiagnoseClients({
      ec2: fakeEc2({
        describeInstances: () => ({
          Reservations: [{ Instances: [{ InstanceId: 'i-hub-1' }] }],
        }),
        describeInstanceAttribute: () => ({ SourceDestCheck: { Value: false } }),
        describeSecurityGroups: ({ name }) => {
          if (name === 'pegasus-wireguard-hub') {
            return {
              SecurityGroups: [
                {
                  GroupId: 'sg-hub',
                  IpPermissions: [{ UserIdGroupPairs: [{ GroupId: 'sg-proxy' }] }],
                },
              ],
            }
          }
          return { SecurityGroups: [{ GroupId: 'sg-proxy' }] }
        },
        describeRouteTables: () => ({
          RouteTables: [
            {
              RouteTableId: 'rtb-1',
              Routes: [{ DestinationCidrBlock: '10.200.0.0/16', InstanceId: 'i-hub-1' }],
            },
          ],
        }),
      }),
      ssm: fakeSsm({
        'ip route show 10.200.0.0/16': { exitCode: 0, stdout: '10.200.0.0/16 dev wg0\n' },
        'iptables -t nat -C POSTROUTING -o wg0 -j MASQUERADE': { exitCode: 0 },
        'wg show wg0': { exitCode: 0, stdout: FRESH_HANDSHAKE_OUTPUT },
      }),
    })
    mockTunnelFetch.mockResolvedValue({
      status: 403,
      headers: {},
      body: '{"error":"Missing X-Windows-User header"}',
    })
    const report = await getReport(buildApp())
    expect(report.summary).toBe('pass')
    const tcp = report.checks.find((c) => c.id === 'tcp_connect')!
    expect(tcp.status).toBe('pass')
    expect(tcp.detail).toContain('connectivity OK')
  })

  it('skips SSM checks when hub instance is missing', async () => {
    setVpnDiagnoseClients({
      ec2: fakeEc2({
        describeInstances: () => ({ Reservations: [] }),
      }),
      ssm: fakeSsm({}),
    })
    const report = await getReport(buildApp())
    expect(report.firstFailure).toBe('hub_instance')
    const skipped = report.checks.filter((c) => c.status === 'skip').map((c) => c.id)
    expect(skipped).toContain('hub_kernel_route')
    expect(skipped).toContain('hub_masquerade')
    expect(skipped).toContain('hub_wg_handshake')
  })
})
