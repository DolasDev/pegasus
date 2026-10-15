// ---------------------------------------------------------------------------
// DriverGateway factory — resolves a tenant to a live pegII-backed
// DriverGateway.
//
// Like the OrderGateway factory, there is no cloud/Postgres alternative:
// driver financials live only in the legacy pegII system, so there is exactly one source.
// The factory's job is to resolve the tenant's on-prem base URL + credential
// (via resolvePegiiOverlayTarget) and build the gateway.
//
// A tenant with no reachable pegII target is a HARD ERROR — the factory throws
// PegiiApiError('PEGII_API_NOT_CONFIGURED', ...) rather than degrading to stub
// data, so an unconfigured tenant surfaces a stable failure instead of pretend
// records. This mirrors resolveOrderGateway.
//
// Tenant and VpnPeer are NOT tenant-scoped models, so the request-scoped db is
// safe for the overlay lookup.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import type { PegiiCaller } from '../lib/pegii-request-context'
import type { DriverGateway } from './driver.gateway'
import { createPegiiDriverGateway } from './pegii-driver.gateway'
import { resolvePegiiOverlayTarget } from '../lib/pegii-overlay-target'
import { PegiiApiError } from '../lib/pegii-api-client'
import { logger } from '../lib/logger'

/**
 * Resolve the DriverGateway for a tenant. Throws
 * PegiiApiError('PEGII_API_NOT_CONFIGURED', ...) when the tenant has no
 * reachable pegII overlay target, so the caller surfaces a stable error rather
 * than silently returning stub data.
 */
export async function resolveDriverGateway(
  db: PrismaClient,
  tenantId: string,
  /** Resolves the calling principal + company; invoked only when a pegII gateway is built. */
  callerOf?: () => Promise<PegiiCaller>,
): Promise<DriverGateway> {
  const resolved = await resolvePegiiOverlayTarget(db, tenantId)
  if (!resolved.ok) {
    logger.warn('pegII driver source unavailable — no fallback permitted', {
      tenantId,
      code: resolved.code,
    })
    throw new PegiiApiError(
      'PEGII_API_NOT_CONFIGURED',
      `tenant ${tenantId} has no reachable pegII driver source: ${resolved.message}`,
    )
  }

  return createPegiiDriverGateway({
    tenantId,
    baseUrl: resolved.target.base,
    apiKey: resolved.target.apiKey,
    ...(callerOf ? { caller: await callerOf() } : {}),
  })
}
