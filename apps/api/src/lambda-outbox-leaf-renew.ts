// ---------------------------------------------------------------------------
// Scheduled Lambda — Outbox Relay leaf-certificate renewal.
//
// The on-prem relay authenticates to AWS via IAM Roles Anywhere using an X.509
// leaf cert (1-yr) that chains to a self-managed CA. The leaf lives on the
// Windows host, but AWS can't push to it, so renewal is split:
//   * THIS Lambda (monthly, EventBridge) mints a fresh leaf signed by the CA
//     private key (SSM SecureString) and writes leaf.pem / leaf.key back to SSM.
//   * A scheduled task on the host pulls those two params and swaps the files
//     (it authenticates the pull with its current, still-valid Roles Anywhere
//     creds — monthly cadence on a 1-yr cert means many renewals of slack).
//
// Cert issuance is pure Node (no openssl in Lambda): @peculiar/x509 over
// WebCrypto. reflect-metadata MUST be imported first — @peculiar/x509 pulls in
// tsyringe, which needs the Reflect polyfill at load time.
// ---------------------------------------------------------------------------

import 'reflect-metadata'
import * as x509 from '@peculiar/x509'
import { webcrypto as crypto } from 'node:crypto'
import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm'
import { createLogger } from './lib/logger'

const logger = createLogger('pegasus-outbox-leaf-renew')
x509.cryptoProvider.set(crypto)

const ssm = new SSMClient({})

/** SSM parameter names + issuance config, all from the Lambda environment. */
const CA_CERT_PARAM = process.env['OUTBOX_CA_CERT_PARAM'] ?? ''
const CA_KEY_PARAM = process.env['OUTBOX_CA_KEY_PARAM'] ?? ''
const LEAF_CERT_PARAM = process.env['OUTBOX_LEAF_CERT_PARAM'] ?? ''
const LEAF_KEY_PARAM = process.env['OUTBOX_LEAF_KEY_PARAM'] ?? ''
const LEAF_CN = process.env['OUTBOX_LEAF_CN'] ?? 'pegasus-outbox-relay'
const LEAF_DAYS = Number(process.env['OUTBOX_LEAF_DAYS'] ?? '365')
// CMK that encrypts the SecureString leaf key — the same key the relay role can
// decrypt (it holds kms:Decrypt on it for the encrypted topic), so the host pull
// works without granting it the default aws/ssm key.
const KMS_KEY_ID = process.env['OUTBOX_KMS_KEY_ID'] ?? ''

function pemToDer(pem: string): Uint8Array {
  return Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64')
}

function derToPem(der: ArrayBuffer, label: string): string {
  const b64 = Buffer.from(der)
    .toString('base64')
    .replace(/(.{64})/g, '$1\n')
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`
}

async function getParam(name: string, decrypt: boolean): Promise<string> {
  const out = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: decrypt }))
  const value = out.Parameter?.Value
  if (!value) throw new Error(`SSM parameter ${name} is empty or missing`)
  return value
}

async function issueLeaf(
  caCertPem: string,
  caKeyPkcs8Pem: string,
): Promise<{
  certPem: string
  keyPem: string
  notAfter: Date
}> {
  const caCert = new x509.X509Certificate(caCertPem)
  const caKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(caKeyPkcs8Pem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const leafKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])

  const notBefore = new Date()
  const notAfter = new Date(notBefore.getTime() + LEAF_DAYS * 24 * 60 * 60 * 1000)
  const serialNumber = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex')

  const cert = await x509.X509CertificateGenerator.create({
    serialNumber,
    subject: `CN=${LEAF_CN}, O=Dolas`,
    issuer: caCert.subject,
    notBefore,
    notAfter,
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    publicKey: leafKeys.publicKey,
    signingKey: caKey,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      // clientAuth — the EKU Roles Anywhere expects on the end-entity cert.
      new x509.ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.2'], false),
      await x509.AuthorityKeyIdentifierExtension.create(caCert),
      await x509.SubjectKeyIdentifierExtension.create(leafKeys.publicKey),
    ],
  })

  const keyDer = await crypto.subtle.exportKey('pkcs8', leafKeys.privateKey)
  return {
    certPem: cert.toString('pem'),
    keyPem: derToPem(keyDer, 'PRIVATE KEY'),
    notAfter,
  }
}

export async function handler(): Promise<{ rotated: true; notAfter: string }> {
  for (const [k, v] of Object.entries({
    OUTBOX_CA_CERT_PARAM: CA_CERT_PARAM,
    OUTBOX_CA_KEY_PARAM: CA_KEY_PARAM,
    OUTBOX_LEAF_CERT_PARAM: LEAF_CERT_PARAM,
    OUTBOX_LEAF_KEY_PARAM: LEAF_KEY_PARAM,
  })) {
    if (!v) throw new Error(`missing required env ${k}`)
  }

  const [caCertPem, caKeyPem] = await Promise.all([
    getParam(CA_CERT_PARAM, false),
    getParam(CA_KEY_PARAM, true),
  ])

  const { certPem, keyPem, notAfter } = await issueLeaf(caCertPem, caKeyPem)

  // Cert is public (String); key is private (SecureString). Overwrite in place;
  // the host's next scheduled pull picks them up.
  await ssm.send(
    new PutParameterCommand({
      Name: LEAF_CERT_PARAM,
      Value: certPem,
      Type: 'String',
      Overwrite: true,
    }),
  )
  await ssm.send(
    new PutParameterCommand({
      Name: LEAF_KEY_PARAM,
      Value: keyPem,
      Type: 'SecureString',
      Overwrite: true,
      ...(KMS_KEY_ID ? { KeyId: KMS_KEY_ID } : {}),
    }),
  )

  logger.info('outbox relay leaf renewed', {
    cn: LEAF_CN,
    notAfter: notAfter.toISOString(),
    leafCertParam: LEAF_CERT_PARAM,
  })
  return { rotated: true, notAfter: notAfter.toISOString() }
}
