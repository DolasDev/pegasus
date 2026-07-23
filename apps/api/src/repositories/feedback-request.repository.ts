// ---------------------------------------------------------------------------
// FeedbackRequest repository
//
// One row per minted capability link. Only the SHA-256 hash of the token is
// stored (see lib/opaque-token); the plaintext lives only in the returned URL.
// The 12-char prefix indexes the public-endpoint lookup, which then timing-safe
// compares the full hash.
//
// Two client contexts:
//   - mint / status reads → the tenant-scoped client (auto-scoped model).
//   - public respond path → the ROOT client, resolving the tenant FROM the token
//     (findByTokenPrefix + recordSubmission), exactly like the ingress endpoint.
// ---------------------------------------------------------------------------

import type { PrismaClient, Prisma } from '@prisma/client'
import { generateOpaqueToken } from '../lib/opaque-token'

export type FeedbackRequestStatus = 'PENDING' | 'SUBMITTED' | 'EXPIRED'

export type FeedbackRequestRow = {
  id: string
  tenantId: string
  formKey: string
  formVersion: number
  subjectType: string
  subjectId: string
  status: FeedbackRequestStatus
  expiresAt: Date
  respondedAt: Date | null
  responsePayload: Prisma.JsonValue | null
  createdAt: Date
}

/** Auth-path row for the public endpoint — carries the hash for the compare. */
export type FeedbackRequestAuthRow = {
  id: string
  tenantId: string
  tokenHash: string
  formKey: string
  formVersion: number
  subjectType: string
  subjectId: string
  status: FeedbackRequestStatus
  expiresAt: Date
}

const SELECT = {
  id: true,
  tenantId: true,
  formKey: true,
  formVersion: true,
  subjectType: true,
  subjectId: true,
  status: true,
  expiresAt: true,
  respondedAt: true,
  responsePayload: true,
  createdAt: true,
} as const

const AUTH_SELECT = {
  id: true,
  tenantId: true,
  tokenHash: true,
  formKey: true,
  formVersion: true,
  subjectType: true,
  subjectId: true,
  status: true,
  expiresAt: true,
} as const

export interface MintRequestInput {
  tenantId: string
  formKey: string
  formVersion: number
  subjectType: string
  subjectId: string
  expiresAt: Date
}

export function createFeedbackRequestRepository(db: PrismaClient) {
  return {
    /** Mint a request row + its capability token. The plaintext is returned once. */
    async mint(input: MintRequestInput): Promise<{ row: FeedbackRequestRow; plainToken: string }> {
      const { plainToken, tokenPrefix, tokenHash } = generateOpaqueToken('fbk')
      const row = await db.feedbackRequest.create({
        data: {
          tenantId: input.tenantId,
          tokenPrefix,
          tokenHash,
          formKey: input.formKey,
          formVersion: input.formVersion,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          expiresAt: input.expiresAt,
        },
        select: SELECT,
      })
      return { row, plainToken }
    },

    /** Status read by id (tenant-scoped client), or null. */
    async findById(id: string): Promise<FeedbackRequestRow | null> {
      return db.feedbackRequest.findFirst({ where: { id }, select: SELECT })
    },

    /** All rows sharing a token prefix (public path — uses the root db). */
    async findByTokenPrefix(tokenPrefix: string): Promise<FeedbackRequestAuthRow[]> {
      return db.feedbackRequest.findMany({ where: { tokenPrefix }, select: AUTH_SELECT })
    },

    /**
     * Record a valid submission, enforcing single-submit at the DB level: the
     * update only matches a row still PENDING, so a concurrent double-submit
     * flips exactly one and the other sees count 0. Returns whether THIS call
     * recorded the response.
     */
    async recordSubmission(id: string, responsePayload: Prisma.InputJsonValue): Promise<boolean> {
      const { count } = await db.feedbackRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'SUBMITTED', respondedAt: new Date(), responsePayload },
      })
      return count === 1
    },
  }
}

export type FeedbackRequestRepository = ReturnType<typeof createFeedbackRequestRepository>
