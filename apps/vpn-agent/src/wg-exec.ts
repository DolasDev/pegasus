// ---------------------------------------------------------------------------
// Shell wrappers around `wg show wg0 dump`, `wg set wg0 peer ...`.
// The agent runs as root on the hub; these commands require it.
//
// Swappable via the WgExec interface so tests can pass a stubbed in-memory
// implementation (no shelling out).
// ---------------------------------------------------------------------------

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseWgDump, type WgDump } from './wg-parser'

const execFileAsync = promisify(execFile)

export interface WgExec {
  /** Dump the current kernel state. */
  showDump(): Promise<WgDump>
  /** Add or update a peer: `wg set wg0 peer <pub> allowed-ips <cidr>`. */
  addPeer(publicKey: string, allowedIps: string): Promise<void>
  /** Remove a peer: `wg set wg0 peer <pub> remove`. */
  removePeer(publicKey: string): Promise<void>
}

export interface WgExecConfig {
  /** Name of the wg interface. Defaults to "wg0". */
  iface?: string
  /** When true, log commands instead of executing them. */
  dryRun?: boolean
  /** Custom log sink (defaults to console.log). */
  log?: (line: string) => void
}

export function createWgExec(config: WgExecConfig = {}): WgExec {
  const iface = config.iface ?? 'wg0'
  const log = config.log ?? ((line) => console.log(line))

  async function run(args: string[]): Promise<string> {
    if (config.dryRun) {
      log(JSON.stringify({ event: 'wg.dry_run', args }))
      return ''
    }
    const { stdout } = await execFileAsync('wg', args)
    return stdout
  }

  return {
    async showDump(): Promise<WgDump> {
      const stdout = await run(['show', iface, 'dump'])
      return parseWgDump(stdout)
    },

    async addPeer(publicKey, allowedIps): Promise<void> {
      await run(['set', iface, 'peer', publicKey, 'allowed-ips', allowedIps])
    },

    async removePeer(publicKey): Promise<void> {
      await run(['set', iface, 'peer', publicKey, 'remove'])
    },
  }
}
