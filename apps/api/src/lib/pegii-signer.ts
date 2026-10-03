// ---------------------------------------------------------------------------
// ES256 signers for cloud-issued pegII tokens (see lib/pegii-token.ts and the
// "Token contract (I1 ↔ I2)" section of plans/todo/cloud-identity-and-companies.md).
//
// A Signer returns the JOSE form of an ECDSA P-256 signature: raw R‖S, 64 bytes.
// KMS returns the DER-encoded ECDSA-Sig-Value instead, so the KMS signer converts.
// The local signer (node:crypto) exists for tests and the shared token fixture.
// ---------------------------------------------------------------------------

import { sign as cryptoSign, type KeyObject } from 'node:crypto'
import { KMSClient, SignCommand } from '@aws-sdk/client-kms'

export interface Signer {
  /** The `kid` stamped on tokens — the KMS key id for the KMS signer. */
  readonly keyId: string
  /** Sign the JWS signing input; returns raw R‖S (64 bytes). */
  sign(input: Uint8Array): Promise<Uint8Array>
}

const COORD_BYTES = 32

/**
 * Convert a DER ECDSA-Sig-Value (SEQUENCE { INTEGER r, INTEGER s }) to the raw
 * fixed-width R‖S form JWS ES256 uses. DER integers are minimal two's
 * complement: a leading 0x00 is added when the high bit is set and leading zero
 * bytes are dropped, so each is normalised back to exactly 32 bytes.
 */
export function derToRawEcdsa(der: Uint8Array): Uint8Array {
  let offset = 0
  const fail = (why: string): never => {
    throw new Error(`invalid DER ECDSA signature: ${why}`)
  }
  const readLength = (): number => {
    const first = der[offset++] ?? fail('truncated length')
    if (first < 0x80) return first
    const count = first & 0x7f
    if (count === 0 || count > 2) fail('unsupported length encoding')
    let len = 0
    for (let i = 0; i < count; i++) len = (len << 8) | (der[offset++] ?? fail('truncated length'))
    return len
  }
  const readInteger = (): Uint8Array => {
    if (der[offset++] !== 0x02) fail('expected INTEGER')
    const len = readLength()
    let bytes = der.subarray(offset, offset + len)
    if (bytes.length !== len) fail('truncated INTEGER')
    offset += len
    while (bytes.length > COORD_BYTES && bytes[0] === 0x00) bytes = bytes.subarray(1)
    if (bytes.length > COORD_BYTES) fail(`INTEGER longer than ${COORD_BYTES} bytes`)
    const out = new Uint8Array(COORD_BYTES)
    out.set(bytes, COORD_BYTES - bytes.length)
    return out
  }

  if (der[offset++] !== 0x30) fail('expected SEQUENCE')
  const seqLen = readLength()
  if (offset + seqLen !== der.length) fail('SEQUENCE length mismatch')
  const r = readInteger()
  const s = readInteger()
  if (offset !== der.length) fail('trailing bytes')

  const raw = new Uint8Array(COORD_BYTES * 2)
  raw.set(r, 0)
  raw.set(s, COORD_BYTES)
  return raw
}

/** Test/fixture signer backed by a local P-256 private key. */
export function createLocalSigner(opts: { keyId: string; privateKey: KeyObject }): Signer {
  return {
    keyId: opts.keyId,
    async sign(input) {
      return new Uint8Array(
        cryptoSign('sha256', input, { key: opts.privateKey, dsaEncoding: 'ieee-p1363' }),
      )
    },
  }
}

/** Minimal surface of KMSClient the signer needs — a test seam. */
export interface KmsSendClient {
  send(command: SignCommand): Promise<{ Signature?: Uint8Array }>
}

/**
 * Production signer: KMS `Sign` with an ECC_NIST_P256 / SIGN_VERIFY key. The
 * private key never leaves KMS; the API role holds only kms:Sign + kms:GetPublicKey.
 */
export function createKmsSigner(opts: { keyId: string; client?: KmsSendClient }): Signer {
  const client: KmsSendClient = opts.client ?? (new KMSClient({}) as unknown as KmsSendClient)
  return {
    keyId: opts.keyId,
    async sign(input) {
      const out = await client.send(
        new SignCommand({
          KeyId: opts.keyId,
          Message: input,
          MessageType: 'RAW',
          SigningAlgorithm: 'ECDSA_SHA_256',
        }),
      )
      if (!out.Signature) throw new Error(`KMS returned no signature for key ${opts.keyId}`)
      return derToRawEcdsa(out.Signature)
    },
  }
}
