// ---------------------------------------------------------------------------
// Pure parser for `wg show wg0 dump` output.
//
// Line 1 describes the interface; subsequent lines describe peers. Fields are
// tab-separated. See wireguard-tools/src/show.c for the canonical schema.
//
// Interface: privateKey, publicKey, listenPort, fwmark
// Peer:      publicKey, presharedKey, endpoint, allowedIps,
//            latestHandshakeEpoch, rxBytes, txBytes, persistentKeepalive
// ---------------------------------------------------------------------------

export interface WgInterface {
  publicKey: string
  listenPort: number
}

export interface WgPeer {
  publicKey: string
  /** Dotted-quad with /32 — e.g. `10.200.7.1/32`. Empty string when unset. */
  allowedIps: string
  /** `Date` when the kernel recorded a handshake, null otherwise. */
  lastHandshakeAt: Date | null
  rxBytes: bigint
  txBytes: bigint
}

export interface WgDump {
  iface: WgInterface
  peers: WgPeer[]
}

/** Parse the output of `wg show wg0 dump`. Empty input → no interface, no peers. */
export function parseWgDump(stdout: string): WgDump {
  const lines = stdout.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) {
    return { iface: { publicKey: '', listenPort: 0 }, peers: [] }
  }

  const [ifaceLine, ...peerLines] = lines
  const ifaceFields = (ifaceLine ?? '').split('\t')
  const iface: WgInterface = {
    publicKey: ifaceFields[1] ?? '',
    listenPort: Number(ifaceFields[2] ?? '0'),
  }

  const peers = peerLines.map(parsePeerLine)
  return { iface, peers }
}

function parsePeerLine(line: string): WgPeer {
  const f = line.split('\t')
  const epoch = Number(f[4] ?? '0')
  return {
    publicKey: f[0] ?? '',
    allowedIps: f[3] ?? '',
    lastHandshakeAt: epoch > 0 ? new Date(epoch * 1000) : null,
    rxBytes: toBigInt(f[5] ?? '0'),
    txBytes: toBigInt(f[6] ?? '0'),
  }
}

function toBigInt(raw: string): bigint {
  try {
    return BigInt(raw)
  } catch {
    return 0n
  }
}
