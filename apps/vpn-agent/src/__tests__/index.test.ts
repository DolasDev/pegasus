import { describe, it, expect, vi } from 'vitest'
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch'
import { runTick } from '../index'
import type { DesiredPeer } from '../reconciler'
import type { WgDump, WgPeer } from '../wg-parser'

function stubApi(peers: DesiredPeer[], generation = 42) {
  const patchPeer = vi.fn().mockResolvedValue(undefined)
  const getPeers = vi.fn().mockResolvedValue({ peers, generation, etag: `"${generation}"` })
  return { getPeers, patchPeer }
}

function stubWg(initial: WgPeer[] = []) {
  const state: WgPeer[] = [...initial]
  const dump: WgDump = { iface: { publicKey: 'HUBPUB', listenPort: 51820 }, peers: state }
  return {
    showDump: vi.fn(async () => ({ ...dump, peers: [...state] })),
    addPeer: vi.fn(async (publicKey: string, allowedIps: string) => {
      state.push({
        publicKey,
        allowedIps,
        lastHandshakeAt: null,
        rxBytes: 0n,
        txBytes: 0n,
      })
    }),
    removePeer: vi.fn(async (publicKey: string) => {
      const idx = state.findIndex((p) => p.publicKey === publicKey)
      if (idx >= 0) state.splice(idx, 1)
    }),
    _state: state,
  }
}

describe('runTick', () => {
  it('adds a newly-PENDING peer to the kernel', async () => {
    const api = stubApi([
      {
        id: 'vpn_A',
        tenantId: 'tnt_A',
        publicKey: 'PUB_A',
        allowedIps: '10.200.0.2/32',
        status: 'PENDING',
      },
    ])
    const wg = stubWg([])
    await runTick({
      api,
      wg,
      cw: null,
      state: { lastEtag: null, lastDesired: [], lastReconcileMs: Date.now() },
    })
    expect(wg.addPeer).toHaveBeenCalledWith('PUB_A', '10.200.0.2/32')
  })

  it('removes a SUSPENDED peer still present in the kernel', async () => {
    const api = stubApi([
      {
        id: 'vpn_A',
        tenantId: 'tnt_A',
        publicKey: 'PUB_A',
        allowedIps: '10.200.0.2/32',
        status: 'SUSPENDED',
      },
    ])
    const wg = stubWg([
      {
        publicKey: 'PUB_A',
        allowedIps: '10.200.0.2/32',
        lastHandshakeAt: null,
        rxBytes: 0n,
        txBytes: 0n,
      },
    ])
    await runTick({
      api,
      wg,
      cw: null,
      state: { lastEtag: null, lastDesired: [], lastReconcileMs: Date.now() },
    })
    expect(wg.removePeer).toHaveBeenCalledWith('PUB_A')
  })

  it('promotes PENDING → ACTIVE via PATCH when a handshake is observed', async () => {
    const api = stubApi([
      {
        id: 'vpn_A',
        tenantId: 'tnt_A',
        publicKey: 'PUB_A',
        allowedIps: '10.200.0.2/32',
        status: 'PENDING',
      },
    ])
    const handshakeAt = new Date('2026-04-21T12:00:00Z')
    const wg = stubWg([
      {
        publicKey: 'PUB_A',
        allowedIps: '10.200.0.2/32',
        lastHandshakeAt: handshakeAt,
        rxBytes: 100n,
        txBytes: 200n,
      },
    ])
    await runTick({
      api,
      wg,
      cw: null,
      state: { lastEtag: null, lastDesired: [], lastReconcileMs: Date.now() },
    })
    expect(api.patchPeer).toHaveBeenCalledWith('vpn_A', {
      status: 'ACTIVE',
      lastHandshakeAt: handshakeAt.toISOString(),
      rxBytes: '100',
      txBytes: '200',
    })
  })

  it('emits AgentHeartbeat and HubEipAssociated metrics when eipCheck is provided', async () => {
    const api = stubApi([])
    const wg = stubWg([])
    const sent: Array<{
      Namespace?: string
      MetricData?: Array<{ MetricName?: string; Value?: number }>
    }> = []
    const cw = {
      send: vi.fn(async (cmd: { input: (typeof sent)[number] }) => {
        sent.push(cmd.input)
        return {}
      }),
    } as unknown as CloudWatchClient
    const eipCheck = { isAssociated: vi.fn(async () => 1 as const) }

    await runTick({
      api,
      wg,
      cw,
      state: { lastEtag: null, lastDesired: [], lastReconcileMs: Date.now() },
      eipCheck,
    })

    expect(eipCheck.isAssociated).toHaveBeenCalledTimes(1)
    const metricNames = sent.flatMap((p) => p.MetricData ?? []).map((d) => d.MetricName)
    expect(metricNames).toContain('AgentHeartbeat')
    expect(metricNames).toContain('HubEipAssociated')
    const heartbeat = sent
      .flatMap((p) => p.MetricData ?? [])
      .find((d) => d.MetricName === 'AgentHeartbeat')
    expect(heartbeat?.Value).toBe(1)
    const eipMetric = sent
      .flatMap((p) => p.MetricData ?? [])
      .find((d) => d.MetricName === 'HubEipAssociated')
    expect(eipMetric?.Value).toBe(1)
  })

  it('omits HubEipAssociated when eipCheck is absent and still emits AgentHeartbeat', async () => {
    const api = stubApi([])
    const wg = stubWg([])
    const sent: Array<{ MetricData?: Array<{ MetricName?: string }> }> = []
    const cw = {
      send: vi.fn(async (cmd: { input: (typeof sent)[number] }) => {
        sent.push(cmd.input)
        return {}
      }),
    } as unknown as CloudWatchClient

    await runTick({
      api,
      wg,
      cw,
      state: { lastEtag: null, lastDesired: [], lastReconcileMs: Date.now() },
    })

    const metricNames = sent.flatMap((p) => p.MetricData ?? []).map((d) => d.MetricName)
    expect(metricNames).toContain('AgentHeartbeat')
    expect(metricNames).not.toContain('HubEipAssociated')
  })

  it('caches the ETag across ticks — subsequent tick with 304 reuses last desired state', async () => {
    const api = {
      getPeers: vi
        .fn()
        .mockResolvedValueOnce({
          peers: [
            {
              id: 'vpn_A',
              tenantId: 'tnt_A',
              publicKey: 'PUB_A',
              allowedIps: '10.200.0.2/32',
              status: 'PENDING',
            },
          ] satisfies DesiredPeer[],
          generation: 1,
          etag: '"1"',
        })
        .mockResolvedValueOnce({ peers: null, generation: null, etag: '"1"' }),
      patchPeer: vi.fn().mockResolvedValue(undefined),
    }
    const wg = stubWg([])

    const state = {
      lastEtag: null as string | null,
      lastDesired: [] as DesiredPeer[],
      lastReconcileMs: Date.now(),
    }
    await runTick({ api, wg, cw: null, state })
    expect(wg.addPeer).toHaveBeenCalledTimes(1)

    // Second tick: 304, same desired state.
    wg.addPeer.mockClear()
    await runTick({ api, wg, cw: null, state })
    expect(api.getPeers).toHaveBeenLastCalledWith('"1"')
    expect(state.lastDesired).toHaveLength(1)
    expect(wg.addPeer).not.toHaveBeenCalled()
  })
})
