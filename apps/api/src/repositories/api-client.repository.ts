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
  createdAt: Date
  updatedAt: Date
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
  createdAt: true,
  updatedAt: true,
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
    ): Promise<CreateApiClientResult> {
      const { plainKey, keyPrefix, keyHash } = generateApiKey()
      const row = await db.apiClient.create({
        data: { tenantId, name, keyPrefix, keyHash, scopes, createdById },
        select: API_CLIENT_SELECT,
      })
      return { row, plainKey }
    },

    /**
     * Look up by key prefix. Returns the row INCLUDING keyHash so the
     * middleware can perform a timing-safe comparison. Never use this
     * result in an API response.
     */
    findByPrefix(keyPrefix: string): Promise<(ApiClientRow & { keyHash: string }) | null> {
      return db.apiClient.findFirst({
        where: { keyPrefix },
        select: { ...API_CLIENT_SELECT, keyHash: true },
      })
    },

    /** Find a single client by id within a tenant (ownership check). */
    findById(id: string, tenantId: string): Promise<ApiClientRow | null> {
      return db.apiClient.findFirst({
        where: { id, tenantId },
        select: API_CLIENT_SELECT,
      })
    },

    /** List all clients for a tenant — no keyHash, no plainKey. */
    listByTenant(tenantId: string): Promise<ApiClientRow[]> {
      return db.apiClient.findMany({
        where: { tenantId },
        select: API_CLIENT_SELECT,
        orderBy: { createdAt: 'desc' },
      })
    },

    /** Patch name and/or scopes. Caller must verify ownership via findById first. */
    update(
      id: string,
      _tenantId: string,
      patch: { name?: string; scopes?: string[] },
    ): Promise<ApiClientRow> {
      return db.apiClient.update({
        where: { id },
        data: patch,
        select: API_CLIENT_SELECT,
      })
    },

    /** Soft-revoke: set revokedAt to now. Caller must verify ownership via findById first. */
    revoke(id: string, _tenantId: string): Promise<ApiClientRow> {
      return db.apiClient.update({
        where: { id },
        data: { revokedAt: new Date() },
        select: API_CLIENT_SELECT,
      })
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
      return { row, plainKey }
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
