// ---------------------------------------------------------------------------
// TenantTemporalNamespace repository — one Temporal Cloud namespace per
// tenant (Phase 3b). Written by the temporal-provisioner Lambda; read by the
// admin routes and the broker credentials route.
//
// Key material: the API key token is shown once by Temporal Cloud, so
// `storeKey` / `rotateKey` KMS-encrypt it (runtime-token-crypto, the same key
// as the broker credentials) as soon as it is minted. The default projection
// (`SELECT`) never includes the ciphertext; `getDecryptedKey` is the only
// read path that returns the key, and its callers must never log it.
//
// Platform-only: every call takes an explicit tenantId and uses the root db
// (INTENTIONALLY_UNSCOPED in prisma-tenant-isolation.test.ts).
// ---------------------------------------------------------------------------

import { Prisma, type PrismaClient, type TenantTemporalNamespaceStatus } from '@prisma/client'
import { encryptRuntimeToken, decryptRuntimeToken } from '../lib/runtime-token-crypto'

export type TenantTemporalNamespaceRow = {
  id: string
  tenantId: string
  namespace: string
  grpcAddress: string
  cloudServiceAccountId: string | null
  apiKeyId: string | null
  apiKeyExpiresAt: Date | null
  previousApiKeyId: string | null
  previousKeyRetireAt: Date | null
  status: TenantTemporalNamespaceStatus
  step: string | null
  leaseExpiresAt: Date | null
  lastError: string | null
  createdAt: Date
  updatedAt: Date
}

const SELECT = {
  id: true,
  tenantId: true,
  namespace: true,
  grpcAddress: true,
  cloudServiceAccountId: true,
  apiKeyId: true,
  apiKeyExpiresAt: true,
  previousApiKeyId: true,
  previousKeyRetireAt: true,
  status: true,
  step: true,
  leaseExpiresAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.TenantTemporalNamespaceSelect

export type CreateProvisioningResult =
  | { outcome: 'created'; row: TenantTemporalNamespaceRow }
  | { outcome: 'exists'; row: TenantTemporalNamespaceRow }

export type DecryptedTemporalKey = {
  namespace: string
  grpcAddress: string
  apiKeyId: string
  apiKey: string
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export function createTenantTemporalNamespaceRepository(db: PrismaClient) {
  return {
    async findByTenant(tenantId: string): Promise<TenantTemporalNamespaceRow | null> {
      return db.tenantTemporalNamespace.findUnique({ where: { tenantId }, select: SELECT })
    },

    /**
     * Inserts the PROVISIONING row. A concurrent create for the same tenant
     * loses on the unique tenantId and returns the winner's row; any other
     * unique violation (a namespace name owned by another tenant) rethrows.
     */
    async createProvisioning(input: {
      tenantId: string
      namespace: string
      grpcAddress: string
    }): Promise<CreateProvisioningResult> {
      try {
        const row = await db.tenantTemporalNamespace.create({ data: input, select: SELECT })
        return { outcome: 'created', row }
      } catch (err) {
        if (!isUniqueViolation(err)) throw err
        const row = await db.tenantTemporalNamespace.findUnique({
          where: { tenantId: input.tenantId },
          select: SELECT,
        })
        if (!row) throw err
        return { outcome: 'exists', row }
      }
    },

    /**
     * Compare-and-set on status: moves the row to `to` only if it is
     * currently in one of `from`. Returns whether it moved. Clears lastError.
     */
    async transition(
      tenantId: string,
      from: TenantTemporalNamespaceStatus[],
      to: TenantTemporalNamespaceStatus,
    ): Promise<boolean> {
      const { count } = await db.tenantTemporalNamespace.updateMany({
        where: { tenantId, status: { in: from } },
        data: { status: to, lastError: null },
      })
      return count === 1
    },

    /**
     * Takes the row's lease if its status is one of `statuses` and nobody
     * holds an unexpired lease. Returns whether it was taken. The provisioner
     * holds it for its whole run; it expires on its own if the run is killed.
     */
    async claimLease(
      tenantId: string,
      statuses: TenantTemporalNamespaceStatus[],
      { now, until }: { now: Date; until: Date },
    ): Promise<boolean> {
      const { count } = await db.tenantTemporalNamespace.updateMany({
        where: {
          tenantId,
          status: { in: statuses },
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
        },
        data: { leaseExpiresAt: until },
      })
      return count === 1
    },

    async releaseLease(tenantId: string): Promise<void> {
      await db.tenantTemporalNamespace.updateMany({
        where: { tenantId },
        data: { leaseExpiresAt: null },
      })
    },

    /** Rows whose rotated-out key has passed its grace period. */
    async findWithRetirablePreviousKey(now: Date): Promise<TenantTemporalNamespaceRow[]> {
      return db.tenantTemporalNamespace.findMany({
        where: { previousApiKeyId: { not: null }, previousKeyRetireAt: { lte: now } },
        select: SELECT,
      })
    },

    /** Records the last completed provisioning step (plus any ids it produced). */
    async markStep(
      tenantId: string,
      step: string,
      data: { cloudServiceAccountId?: string; grpcAddress?: string } = {},
    ): Promise<void> {
      await db.tenantTemporalNamespace.update({ where: { tenantId }, data: { step, ...data } })
    },

    async markReady(tenantId: string): Promise<void> {
      await db.tenantTemporalNamespace.update({
        where: { tenantId },
        data: { status: 'READY', lastError: null },
      })
    },

    /** FAILED keeps `step`, so a re-invoke resumes after the last good step. */
    async markFailed(tenantId: string, lastError: string): Promise<void> {
      await db.tenantTemporalNamespace.update({
        where: { tenantId },
        data: { status: 'FAILED', lastError },
      })
    },

    /** Records an error without changing status (a failed rotate leaves READY intact). */
    async setLastError(tenantId: string, lastError: string): Promise<void> {
      await db.tenantTemporalNamespace.updateMany({ where: { tenantId }, data: { lastError } })
    },

    /** Stores the namespace's first key. The token is encrypted before it is written. */
    async storeKey(
      tenantId: string,
      key: { apiKeyId: string; token: string; expiresAt: Date },
    ): Promise<void> {
      const apiKeyCiphertext = await encryptRuntimeToken(key.token)
      await db.tenantTemporalNamespace.update({
        where: { tenantId },
        data: { apiKeyId: key.apiKeyId, apiKeyCiphertext, apiKeyExpiresAt: key.expiresAt },
      })
    },

    /**
     * Replaces the current key, keeping the replaced one as `previousApiKeyId`
     * until `retireAt` so running runners aren't cut off. Refuses while an
     * earlier previous key is still recorded: overwriting it would orphan that
     * key in Temporal Cloud. Delete it there, then `clearPreviousKey`, first.
     */
    async rotateKey(
      tenantId: string,
      key: { apiKeyId: string; token: string; expiresAt: Date; retireAt: Date },
    ): Promise<void> {
      const apiKeyCiphertext = await encryptRuntimeToken(key.token)
      await db.$transaction(async (tx) => {
        const current = await tx.tenantTemporalNamespace.findUnique({
          where: { tenantId },
          select: { apiKeyId: true, previousApiKeyId: true },
        })
        if (!current) throw new Error(`no temporal namespace for tenant ${tenantId}`)
        if (current.previousApiKeyId !== null) {
          throw new Error('cannot rotate: a previous key is still pending retirement')
        }
        const { count } = await tx.tenantTemporalNamespace.updateMany({
          where: { tenantId, previousApiKeyId: null },
          data: {
            apiKeyId: key.apiKeyId,
            apiKeyCiphertext,
            apiKeyExpiresAt: key.expiresAt,
            previousApiKeyId: current.apiKeyId,
            previousKeyRetireAt: key.retireAt,
          },
        })
        if (count !== 1) {
          throw new Error('cannot rotate: a previous key is still pending retirement')
        }
      })
    },

    async clearPreviousKey(tenantId: string): Promise<void> {
      await db.tenantTemporalNamespace.update({
        where: { tenantId },
        data: { previousApiKeyId: null, previousKeyRetireAt: null },
      })
    },

    /** The only read path for key material. Null when there's no row or no key yet. */
    async getDecryptedKey(tenantId: string): Promise<DecryptedTemporalKey | null> {
      const row = await db.tenantTemporalNamespace.findUnique({
        where: { tenantId },
        select: { namespace: true, grpcAddress: true, apiKeyId: true, apiKeyCiphertext: true },
      })
      if (!row || row.apiKeyId === null || row.apiKeyCiphertext === null) return null
      return {
        namespace: row.namespace,
        grpcAddress: row.grpcAddress,
        apiKeyId: row.apiKeyId,
        apiKey: await decryptRuntimeToken(row.apiKeyCiphertext),
      }
    },

    async remove(tenantId: string): Promise<void> {
      await db.tenantTemporalNamespace.deleteMany({ where: { tenantId } })
    },
  }
}

export type TenantTemporalNamespaceRepository = ReturnType<
  typeof createTenantTemporalNamespaceRepository
>
