// ---------------------------------------------------------------------------
// TaskGateway factory — resolves a tenant to a live pegII-backed TaskGateway.
//
// Tasks live only in pegII, so there is exactly one source and no fallback: a
// tenant with no reachable pegII target throws
// PegiiApiError('PEGII_API_NOT_CONFIGURED', ...) (→ 503) rather than serving
// invented rows. The in-memory stub this replaces (services/pegii-tasks.ts)
// is gone. Same shape as order-gateway.factory.ts.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import type { PegiiCaller } from '../lib/pegii-request-context'
import type { TaskGateway } from './task.gateway'
import { createPegiiTaskGateway } from './pegii-task.gateway'
import { resolvePegiiOverlayTarget } from '../lib/pegii-overlay-target'
import { PegiiApiError } from '../lib/pegii-api-client'
import { logger } from '../lib/logger'

export async function resolveTaskGateway(
  db: PrismaClient,
  tenantId: string,
  /** Resolves the calling principal + company; invoked only when a pegII gateway is built. */
  callerOf?: () => Promise<PegiiCaller>,
): Promise<TaskGateway> {
  const resolved = await resolvePegiiOverlayTarget(db, tenantId)
  if (!resolved.ok) {
    logger.warn('pegII task source unavailable — no fallback permitted', {
      tenantId,
      code: resolved.code,
    })
    throw new PegiiApiError(
      'PEGII_API_NOT_CONFIGURED',
      `tenant ${tenantId} has no reachable pegII task source: ${resolved.message}`,
    )
  }

  return createPegiiTaskGateway({
    tenantId,
    baseUrl: resolved.target.base,
    apiKey: resolved.target.apiKey,
    ...(callerOf ? { caller: await callerOf() } : {}),
  })
}
