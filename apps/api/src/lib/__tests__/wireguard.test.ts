// ---------------------------------------------------------------------------
// Unit tests for apps/api/src/lib/wireguard.ts — WireGuard keypair generation.
// Pure, no I/O required. Runs without a database or Docker.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'

import { generateWgKeypair } from '../wireguard'

describe('generateWgKeypair()', () => {
  it('returns strings for both keys', async () => {
    const kp = await generateWgKeypair()
    expect(typeof kp.privateKey).toBe('string')
    expect(typeof kp.publicKey).toBe('string')
  })

  it('private key decodes to exactly 32 bytes', async () => {
    const { privateKey } = await generateWgKeypair()
    const bytes = Buffer.from(privateKey, 'base64')
    expect(bytes.length).toBe(32)
  })

  it('public key decodes to exactly 32 bytes', async () => {
    const { publicKey } = await generateWgKeypair()
    const bytes = Buffer.from(publicKey, 'base64')
    expect(bytes.length).toBe(32)
  })

  it('private key is base64-encoded (44 chars incl. padding)', async () => {
    const { privateKey } = await generateWgKeypair()
    expect(privateKey).toHaveLength(44)
    expect(privateKey).toMatch(/^[A-Za-z0-9+/]{43}=$/)
  })

  it('public key is base64-encoded (44 chars incl. padding)', async () => {
    const { publicKey } = await generateWgKeypair()
    expect(publicKey).toHaveLength(44)
    expect(publicKey).toMatch(/^[A-Za-z0-9+/]{43}=$/)
  })

  it('public key is deterministic given the same clamped private key', async () => {
    const { privateKey, publicKey } = await generateWgKeypair()
    const priv = Buffer.from(privateKey, 'base64')
    const derived = Buffer.from(x25519.getPublicKey(priv)).toString('base64')
    expect(derived).toBe(publicKey)
  })

  it('produces a different keypair on each call (randomness check)', async () => {
    const a = await generateWgKeypair()
    const b = await generateWgKeypair()
    expect(a.privateKey).not.toBe(b.privateKey)
    expect(a.publicKey).not.toBe(b.publicKey)
  })

  it('private key passes RFC 7748 X25519 clamping', async () => {
    const { privateKey } = await generateWgKeypair()
    const priv = Buffer.from(privateKey, 'base64')
    // Low 3 bits of byte 0 must be clear.
    expect(priv[0]! & 0b0000_0111).toBe(0)
    // High bit of byte 31 must be clear.
    expect(priv[31]! & 0b1000_0000).toBe(0)
    // Bit 6 of byte 31 must be set.
    expect(priv[31]! & 0b0100_0000).toBe(0b0100_0000)
  })
})
