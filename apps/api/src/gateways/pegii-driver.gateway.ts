// ---------------------------------------------------------------------------
// pegII-backed DriverGateway — a driver's financials from the on-prem
// `Pegasus.Api` via the WireGuard tunnel. Mirrors pegii-salesman.gateway.ts.
//
// Gated on `pegii.drivers.financials.v1` so a site running an older build fails
// with a stable PEGII_API_CAPABILITY_MISSING rather than an ambiguous 404.
// ---------------------------------------------------------------------------

import type { DriverGateway } from './driver.gateway'
import type { PegiiCaller } from '../lib/pegii-request-context'
import { createPegiiApiClient, type PegiiApiClient } from '../lib/pegii-api-client'
import { mapPegiiDriverFinancials } from './pegii/pegii-driver.mapper'
import type { PegiiDriverFinancialsDto } from './pegii/pegii-driver.dto'
import { requirePegiiCapabilities, PegiiCapabilities } from '../lib/pegii-capabilities'

export interface PegiiDriverGatewayOptions {
  tenantId: string
  baseUrl: string
  apiKey?: string | null
  /** Test seam: inject a stub PegiiApiClient instead of the tunnel-backed one. */
  client?: PegiiApiClient
  /** Who is calling (cloud-issued token + x-correlation-id). */
  caller?: PegiiCaller
  /** Test seam: the /version capability gate. */
  requireCapabilities?: typeof requirePegiiCapabilities
}

export function createPegiiDriverGateway(opts: PegiiDriverGatewayOptions): DriverGateway {
  const client =
    opts.client ??
    createPegiiApiClient({
      tenantId: opts.tenantId,
      baseUrl: opts.baseUrl,
      ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
      ...(opts.caller ? { caller: opts.caller } : {}),
    })
  const requireCaps = opts.requireCapabilities ?? requirePegiiCapabilities

  return {
    async getFinancials(driverId) {
      await requireCaps(opts.baseUrl, [PegiiCapabilities.DriversFinancials], {
        ...(opts.caller ? { correlationId: opts.caller.correlationId } : {}),
      })
      const dto = await client.get<PegiiDriverFinancialsDto>(
        `/api/v1/pegii/drivers/${encodeURIComponent(String(driverId))}/financials`,
      )
      return mapPegiiDriverFinancials(dto)
    },
  }
}
