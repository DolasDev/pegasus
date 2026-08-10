// ---------------------------------------------------------------------------
// ReportGateway factory — resolves a tenant to a live pegII-backed ReportGateway.
//
// Like orders, there is no cloud alternative: the report definitions and the
// data joins behind them live only in the legacy pegII system, so there is
// exactly one source. The factory's job is to resolve the tenant's on-prem base
// URL + credential (via resolvePegiiOverlayTarget) and build the gateway.
//
// A tenant with no reachable pegII target is a HARD ERROR — the factory throws
// PegiiApiError('PEGII_API_NOT_CONFIGURED', ...), which the route's error
// boundary maps to a legible 503, rather than degrading to an empty document.
// Byte-for-byte the resolveOrderGateway shape.
//
// Tenant and VpnPeer are NOT tenant-scoped models, so the request-scoped db is
// safe for the overlay lookup.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import type { ReportGateway } from './report.gateway'
import { createPegiiReportGateway } from './pegii-report.gateway'
import { resolvePegiiOverlayTarget } from '../lib/pegii-overlay-target'
import { PegiiApiError } from '../lib/pegii-api-client'
import { logger } from '../lib/logger'

/**
 * Resolve the ReportGateway for a tenant. Throws
 * PegiiApiError('PEGII_API_NOT_CONFIGURED', ...) when the tenant has no
 * reachable pegII overlay target.
 */
export async function resolveReportGateway(
  db: PrismaClient,
  tenantId: string,
): Promise<ReportGateway> {
  const resolved = await resolvePegiiOverlayTarget(db, tenantId)
  if (!resolved.ok) {
    logger.warn('pegII report source unavailable — no fallback permitted', {
      tenantId,
      code: resolved.code,
    })
    throw new PegiiApiError(
      'PEGII_API_NOT_CONFIGURED',
      `tenant ${tenantId} has no reachable pegII report source: ${resolved.message}`,
    )
  }

  return createPegiiReportGateway({
    tenantId,
    baseUrl: resolved.target.base,
    apiKey: resolved.target.apiKey,
  })
}
