// ---------------------------------------------------------------------------
// API client repository
//
// Manages ApiClient records — M2M keys issued to external vendor systems.
// The plaintext key is NEVER stored; only a SHA-256 hash is persisted.
// The prefix (first 12 chars) is stored plain for fast indexed lookup.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { logger } from '../lib/logger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A safe projection of the api_clients row — keyHash is intentionally excluded
 * at the Prisma select level so it can never leak into an API response.
 *
 * `roleNames` is resolved from the joined service-account TenantUser; an empty
 * array means the row is stale (no service-account principal bound, e.g. rows
 * created before the service-account migration). The auth middleware rejects
 * such rows.
 */
export type ApiClientRow = {
  id: string
  tenantId: string
  name: string
  keyPrefix: string
  scopes: string[]
  lastUsedAt: Date | null
  revokedAt: Date | null
  createdById: string
  /**
   * Service-account TenantUser this key acts as. Cedar/AVP authorization runs
   * against this user's roleNames. Nullable at the column level but the API
   * enforces non-null on create; rows with null here are stale.
   */
  actsAsUserId: string | null
  /** Resolved from the bound service-account TenantUser. `[]` for stale rows. */
  roleNames: string[]
  createdAt: Date
  updatedAt: Date
}

/**
 * Slim TenantUser projection joined onto the auth lookup so a single query
 * returns everything the middleware needs to construct the principal.
 */
export type ApiClientActsAsUser = {
  id: string
  tenantId: string
  isServiceAccount: boolean
  status: 'PENDING' | 'ACTIVE' | 'DEACTIVATED'
  roleNames: string[]
}

/**
 * Auth-path row shape — like ApiClientRow but with the keyHash retained for
 * timing-safe comparison and the full service-account user join (rather than a
 * flattened roleNames). Never use this in API responses.
 */
export type ApiClientAuthRow = Omit<ApiClientRow, 'roleNames'> & {
  keyHash: string
  actsAsUser: ApiClientActsAsUser | null
}

/** Returned only from create() and rotate() — shown to the caller once, never logged or stored. */
export type CreateApiClientResult = {
  row: ApiClientRow
  plainKey: string
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

/**
 * Generates a new vendor API key.
 *
 * Format: vnd_<48 random hex chars>  (total 52 chars)
 * Prefix:  first 12 chars            (e.g. "vnd_a1b2c3d4")
 * Hash:    SHA-256 hex of full key   (stored; 64 chars)
 */
function generateApiKey(): { plainKey: string; keyPrefix: string; keyHash: string } {
  const hex = crypto.randomBytes(24).toString('hex') // 48 hex chars
  const plainKey = `vnd_${hex}`
  const keyPrefix = plainKey.slice(0, 12) // "vnd_" + 8 hex chars
  const keyHash = crypto.createHash('sha256').update(plainKey).digest('hex')
  return { plainKey, keyPrefix, keyHash }
}

// ---------------------------------------------------------------------------
// Select shape — always excludes keyHash
// ---------------------------------------------------------------------------

const API_CLIENT_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  keyPrefix: true,
  scopes: true,
  lastUsedAt: true,
  revokedAt: true,
  createdById: true,
  actsAsUserId: true,
  createdAt: true,
  updatedAt: true,
  actsAsUser: {
    select: { roleNames: true },
  },
} as const

/** Row shape returned by Prisma against API_CLIENT_SELECT (with the join). */
type ApiClientSelectRow = Omit<ApiClientRow, 'roleNames'> & {
  actsAsUser: { roleNames: string[] } | null
}

/** Flatten the joined actsAsUser.roleNames onto the public ApiClientRow shape. */
function mapRow(row: ApiClientSelectRow): ApiClientRow {
  const { actsAsUser, ...rest } = row
  return { ...rest, roleNames: actsAsUser?.roleNames ?? [] }
}

/**
 * Auth-path projection — adds the joined service-account TenantUser slice and
 * the keyHash so the middleware can do a single query and timing-safe compare.
 * Never use this result in an API response.
 */
const API_CLIENT_AUTH_SELECT = {
  ...API_CLIENT_SELECT,
  keyHash: true,
  actsAsUser: {
    select: {
      id: true,
      tenantId: true,
      isServiceAccount: true,
      status: true,
      roleNames: true,
    },
  },
} as const

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export function createApiClientRepository(db: PrismaClient) {
  return {
    /** Create a new API client and return the plainKey (shown once). */
    async create(
      tenantId: string,
      name: string,
      scopes: string[],
      createdById: string,
      actsAsUserId: string | null = null,
    ): Promise<CreateApiClientResult> {
      const { plainKey, keyPrefix, keyHash } = generateApiKey()
      const row = await db.apiClient.create({
        data: { tenantId, name, keyPrefix, keyHash, scopes, createdById, actsAsUserId },
        select: API_CLIENT_SELECT,
      })
      return { row: mapRow(row), plainKey }
    },

    /**
     * Look up by key prefix. Returns the row INCLUDING keyHash and the joined
     * service-account TenantUser so the middleware can do a single query,
     * timing-safe compare the hash, and construct the Cedar principal. Never
     * use this result in an API response.
     */
    findByPrefix(keyPrefix: string): Promise<ApiClientAuthRow | null> {
      return db.apiClient.findFirst({
        where: { keyPrefix },
        select: API_CLIENT_AUTH_SELECT,
      })
    },

    /** Find a single client by id within a tenant (ownership check). */
    async findById(id: string, tenantId: string): Promise<ApiClientRow | null> {
      const row = await db.apiClient.findFirst({
        where: { id, tenantId },
        select: API_CLIENT_SELECT,
      })
      return row ? mapRow(row) : null
    },

    /** List all clients for a tenant — no keyHash, no plainKey. */
    async listByTenant(tenantId: string): Promise<ApiClientRow[]> {
      const rows = await db.apiClient.findMany({
        where: { tenantId },
        select: API_CLIENT_SELECT,
        orderBy: { createdAt: 'desc' },
      })
      return rows.map(mapRow)
    },

    /** Patch name, scopes, and/or actsAsUserId. Caller must verify ownership via findById first. */
    async update(
      id: string,
      _tenantId: string,
      patch: { name?: string; scopes?: string[]; actsAsUserId?: string | null },
    ): Promise<ApiClientRow> {
      const row = await db.apiClient.update({
        where: { id },
        data: patch,
        select: API_CLIENT_SELECT,
      })
      return mapRow(row)
    },

    /** Soft-revoke: set revokedAt to now. Caller must verify ownership via findById first. */
    async revoke(id: string, _tenantId: string): Promise<ApiClientRow> {
      const row = await db.apiClient.update({
        where: { id },
        data: { revokedAt: new Date() },
        select: API_CLIENT_SELECT,
      })
      return mapRow(row)
    },

    /**
     * Rotate: issue a new key on the same row (new keyHash/keyPrefix, clear revokedAt).
     * The old key is instantly invalid. Caller must verify ownership via findById first.
     */
    async rotate(id: string, _tenantId: string): Promise<CreateApiClientResult> {
      const { plainKey, keyPrefix, keyHash } = generateApiKey()
      const row = await db.apiClient.update({
        where: { id },
        data: { keyPrefix, keyHash, revokedAt: null },
        select: API_CLIENT_SELECT,
      })
      return { row: mapRow(row), plainKey }
    },

    /**
     * Fire-and-forget update of lastUsedAt.
     * Errors are logged at WARN and swallowed — never fail the request.
     */
    touchLastUsed(id: string): Promise<void> {
      return db.apiClient
        .update({ where: { id }, data: { lastUsedAt: new Date() } })
        .then(() => undefined)
        .catch((err: unknown) => {
          logger.warn('touchLastUsed: failed to update lastUsedAt', {
            id,
            error: String(err),
          })
        })
    },
  }
}

export type ApiClientRepository = ReturnType<typeof createApiClientRepository>
