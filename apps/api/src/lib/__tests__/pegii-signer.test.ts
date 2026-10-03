import { describe, it, expect, vi } from 'vitest'
import { generateKeyPairSync, verify } from 'node:crypto'
import { derToRawEcdsa, createLocalSigner, createKmsSigner } from '../pegii-signer'

// A DER ECDSA-Sig-Value: SEQUENCE { INTEGER r, INTEGER s }. DER integers are
// minimal two's-complement, so a value with the high bit set gets a leading 0x00
// (33 bytes) and a value with leading zero bytes is shortened (<32 bytes). JWT
// ES256 needs both as fixed 32-byte big-endian, concatenated.
function derInt(bytes: number[]): number[] {
  return [0x02, bytes.length, ...bytes]
}
function derSeq(r: number[], s: number[]): Uint8Array {
  const body = [...derInt(r), ...derInt(s)]
  return Uint8Array.from([0x30, body.length, ...body])
}

describe('derToRawEcdsa', () => {
  it('passes two 32-byte integers through as R‖S', () => {
    const r = Array.from({ length: 32 }, (_, i) => i + 1)
    const s = Array.from({ length: 32 }, (_, i) => 0x40 + i)
    const raw = derToRawEcdsa(derSeq(r, s))
    expect(Array.from(raw)).toEqual([...r, ...s])
  })

  it('strips the 0x00 sign byte DER adds when the high bit is set (33-byte integer)', () => {
    const r = [0x80, ...Array.from({ length: 31 }, () => 0x11)]
    const s = Array.from({ length: 32 }, () => 0x22)
    const raw = derToRawEcdsa(derSeq([0x00, ...r], s))
    expect(raw.length).toBe(64)
    expect(Array.from(raw.subarray(0, 32))).toEqual(r)
  })

  it('left-pads a short integer back to 32 bytes', () => {
    const r = Array.from({ length: 31 }, () => 0x33)
    const s = Array.from({ length: 30 }, () => 0x44)
    const raw = derToRawEcdsa(derSeq(r, s))
    expect(raw.length).toBe(64)
    expect(Array.from(raw.subarray(0, 32))).toEqual([0x00, ...r])
    expect(Array.from(raw.subarray(32))).toEqual([0x00, 0x00, ...s])
  })

  it('rejects input that is not a DER ECDSA signature', () => {
    expect(() => derToRawEcdsa(Uint8Array.from([0x31, 0x00]))).toThrow(/DER/)
    expect(() => derToRawEcdsa(derSeq(Array(33).fill(0x01), Array(32).fill(0x01)))).toThrow(/32/)
  })

  it('accepts a long-form (0x81) SEQUENCE length', () => {
    const r = Array.from({ length: 32 }, () => 0x05)
    const s = Array.from({ length: 32 }, () => 0x06)
    const body = [...derInt(r), ...derInt(s)]
    const der = Uint8Array.from([0x30, 0x81, body.length, ...body])

    expect(Array.from(derToRawEcdsa(der))).toEqual([...r, ...s])
  })

  it.each([
    ['truncated length', [0x30]],
    ['unsupported length encoding', [0x30, 0x83, 0x00, 0x00, 0x00]],
    ['indefinite length', [0x30, 0x80]],
    ['SEQUENCE length mismatch', [0x30, 0x05, 0x02, 0x01, 0x01]],
    ['expected INTEGER', [0x30, 0x03, 0x04, 0x01, 0x01]],
    ['truncated INTEGER', [0x30, 0x03, 0x02, 0x05, 0x01]],
  ])('rejects %s', (_why, bytes) => {
    expect(() => derToRawEcdsa(Uint8Array.from(bytes))).toThrow(/invalid DER ECDSA signature/)
  })

  it('rejects trailing bytes after s', () => {
    const r = Array.from({ length: 32 }, () => 0x01)
    const s = Array.from({ length: 32 }, () => 0x02)
    const body = [...derInt(r), ...derInt(s), 0x00]
    expect(() => derToRawEcdsa(Uint8Array.from([0x30, body.length, ...body]))).toThrow(
      /trailing bytes/,
    )
  })
})

describe('createLocalSigner', () => {
  it('produces a raw R‖S signature that verifies with the public key', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const signer = createLocalSigner({ keyId: 'test-kid', privateKey })
    const input = new TextEncoder().encode('header.payload')

    const sig = await signer.sign(input)

    expect(signer.keyId).toBe('test-kid')
    expect(sig.length).toBe(64)
    expect(verify('sha256', input, { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig)).toBe(true)
  })
})

describe('createKmsSigner', () => {
  it('signs the raw message with ECDSA_SHA_256 and converts the DER result', async () => {
    const r = Array.from({ length: 32 }, () => 0x01)
    const s = Array.from({ length: 32 }, () => 0x02)
    const send = vi.fn().mockResolvedValue({ Signature: derSeq(r, s) })
    const signer = createKmsSigner({ keyId: 'kms-key-1', client: { send } })
    const input = new TextEncoder().encode('header.payload')

    const sig = await signer.sign(input)

    expect(Array.from(sig)).toEqual([...r, ...s])
    const command = send.mock.calls[0]![0] as { input: Record<string, unknown> }
    expect(command.input).toMatchObject({
      KeyId: 'kms-key-1',
      MessageType: 'RAW',
      SigningAlgorithm: 'ECDSA_SHA_256',
    })
    expect(command.input['Message']).toEqual(input)
  })

  it('fails loudly when KMS returns no signature', async () => {
    const signer = createKmsSigner({ keyId: 'k', client: { send: vi.fn().mockResolvedValue({}) } })
    await expect(signer.sign(new Uint8Array([1]))).rejects.toThrow(/no signature/i)
  })
})
