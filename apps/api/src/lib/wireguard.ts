// ---------------------------------------------------------------------------
// WireGuard keypair generation.
//
// WireGuard uses Curve25519 (X25519) keys. The private key is a 32-byte
// scalar, base64-encoded (44 chars including '=' padding). The public key is
// derived via X25519 scalar multiplication of the private key with the
// Curve25519 base point, then base64-encoded.
//
// The private key is "clamped" per RFC 7748 §5 before use (same as what the
// `wg genkey` CLI does). Clamping makes the scalar a valid X25519 private key
// regardless of the random bytes drawn.
//
// Pure function — no I/O, no env, no global state. Used by the admin VPN
// handler at peer-creation time; the private key is returned once in the
// tenant's `client.conf` and never persisted server-side.
// ---------------------------------------------------------------------------

import { x25519 } from '@noble/curves/ed25519'
import { randomBytes } from 'node:crypto'

export interface WgKeypair {
  /** 32-byte X25519 private key, base64-encoded (44 chars). */
  privateKey: string
  /** 32-byte X25519 public key, base64-encoded (44 chars). */
  publicKey: string
}

/**
 * Generate a WireGuard-compatible X25519 keypair.
 *
 * The returned keys are base64-encoded in the same format that `wg genkey` /
 * `wg pubkey` produce, and are drop-in compatible with `wg set` and the
 * `PrivateKey` / `PublicKey` fields of `wg-quick` config files.
 */
export async function generateWgKeypair(): Promise<WgKeypair> {
  const priv = randomBytes(32)
  // RFC 7748 §5 clamping — matches what `wg genkey` does.
  priv[0]! &= 248
  priv[31]! &= 127
  priv[31]! |= 64
  const pub = x25519.getPublicKey(priv)
  return {
    privateKey: Buffer.from(priv).toString('base64'),
    publicKey: Buffer.from(pub).toString('base64'),
  }
}
