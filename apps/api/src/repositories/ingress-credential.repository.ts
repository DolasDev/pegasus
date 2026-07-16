// ---------------------------------------------------------------------------
// IngressCredential repository (sdk-feedback 0021)
//
// The bearer a third party presents to the platform ingress endpoint. Only the
// SHA-256 hash is stored; the plaintext (`ing_<48 hex>`) is returned once at
// issue and never again. The 12-char prefix indexes the auth-path lookup, which
// then timing-safe-compares the full hash (same shape as ApiClient keys).
//
// One credential per (tenant, integration): `create` mints the first, `rotate`
// overwrites the hash+prefix in place (old token stops working immediately).
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'
import type { PrismaClient } from '@prisma/client'

/** Mint a new ingress token: `ing_<48 hex>`, its 12-char prefix, and its hash. */
export function generateIngressToken(): {
  plainToken: string
  tokenPrefix: string
  tokenHash: string
} {
  const hex = crypto.randomBytes(24).toString('hex') // 48 hex chars
  const plainToken = `ing_${hex}`
  const tokenPrefix = plainToken.slice(0, 12) // "ing_" + 8 hex chars
  const tokenHash = crypto.createHash('sha256').update(plainToken).digest('hex')
  return { plainToken, tokenPrefix, tokenHash }
}

/** Auth-path row — carries the hash for the timing-safe compare. */
export type IngressAuthRow = {
  id: string
  tenantId: string
  integrationId: string
  tokenHash: string
  enabled: boolean
}

/** Safe metadata projection — never includes the hash. */
export type IngressMetaRow = {
  id: string
  tenantId: string
  integrationId: string
  tokenPrefix: string
  enabled: boolean
  createdAt: Date
  rotatedAt: Date | null
}

const META_SELECT = {
  id: true,
  tenantId: true,
  integrationId: true,
  tokenPrefix: true,
  enabled: true,
  createdAt: true,
  rotatedAt: true,
} as const

export function createIngressCredentialRepository(db: PrismaClient) {
  return {
    /** All rows sharing a token prefix (auth path — uses the root db). */
    async findByTokenPrefix(tokenPrefix: string): Promise<IngressAuthRow[]> {
      return db.ingressCredential.findMany({
        where: { tokenPrefix },
        select: { id: true, tenantId: true, integrationId: true, tokenHash: true, enabled: true },
      })
    },

    /** Tenant-scoped metadata for an integration's credential (GET), or null. */
    async findMetaForScope(integrationId: string): Promise<IngressMetaRow | null> {
      return db.ingressCredential.findFirst({ where: { integrationId }, select: META_SELECT })
    },

    /** Mint the first credential for an integration. Returns null if one exists. */
    async create(input: {
      tenantId: string
      integrationId: string
      createdByUserId: string
    }): Promise<{ meta: IngressMetaRow; plainToken: string } | null> {
      const existing = await db.ingressCredential.findFirst({
        where: { integrationId: input.integrationId },
        select: { id: true },
      })
      if (existing) return null
      const { plainToken, tokenPrefix, tokenHash } = generateIngressToken()
      const meta = await db.ingressCredential.create({
        data: {
          tenantId: input.tenantId,
          integrationId: input.integrationId,
          tokenPrefix,
          tokenHash,
          createdByUserId: input.createdByUserId,
        },
        select: META_SELECT,
      })
      return { meta, plainToken }
    },

    /** Rotate an existing credential's token. Returns null if none exists. */
    async rotate(
      integrationId: string,
    ): Promise<{ meta: IngressMetaRow; plainToken: string } | null> {
      const existing = await db.ingressCredential.findFirst({
        where: { integrationId },
        select: { id: true },
      })
      if (!existing) return null
      const { plainToken, tokenPrefix, tokenHash } = generateIngressToken()
      const meta = await db.ingressCredential.update({
        where: { id: existing.id },
        data: { tokenPrefix, tokenHash, rotatedAt: new Date() },
        select: META_SELECT,
      })
      return { meta, plainToken }
    },
  }
}

export type IngressCredentialRepository = ReturnType<typeof createIngressCredentialRepository>
