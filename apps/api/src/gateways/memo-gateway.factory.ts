// ---------------------------------------------------------------------------
// MemoGateway factory — resolves a tenant to a live pegII-backed MemoGateway.
//
// Memos and the desktop's text-message store live only in pegII, so there is
// exactly one source and no fallback: a tenant with no reachable pegII target
// throws PegiiApiError('PEGII_API_NOT_CONFIGURED', ...) (→ 503). Same shape as
// task-gateway.factory.ts.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import type { PegiiCaller } from '../lib/pegii-request-context'
import type { MemoGateway } from './memo.gateway'
import { createPegiiMemoGateway } from './pegii-memo.gateway'
import { resolvePegiiOverlayTarget } from '../lib/pegii-overlay-target'
import { PegiiApiError } from '../lib/pegii-api-client'
import { logger } from '../lib/logger'

export async function resolveMemoGateway(
  db: PrismaClient,
  tenantId: string,
  /** Resolves the calling principal + company; invoked only when a pegII gateway is built. */
  callerOf?: () => Promise<PegiiCaller>,
): Promise<MemoGateway> {
  const resolved = await resolvePegiiOverlayTarget(db, tenantId)
  if (!resolved.ok) {
    logger.warn('pegII memo source unavailable — no fallback permitted', {
      tenantId,
      code: resolved.code,
    })
    throw new PegiiApiError(
      'PEGII_API_NOT_CONFIGURED',
      `tenant ${tenantId} has no reachable pegII memo source: ${resolved.message}`,
    )
  }

  return createPegiiMemoGateway({
    tenantId,
    baseUrl: resolved.target.base,
    apiKey: resolved.target.apiKey,
    ...(callerOf ? { caller: await callerOf() } : {}),
  })
}
