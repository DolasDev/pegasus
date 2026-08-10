// ---------------------------------------------------------------------------
// pegII-backed ReportGateway — fetches a rendered report document from the pegII
// team's on-prem domain API via the WireGuard tunnel.
//
// Composes createPegiiApiClient (transport) with mapPegiiReportToRecord
// (anti-corruption). The resource path is the contract the pegII team shipped:
// `/api/v1/pegii/reports/:reportType/:id`.
//
// We deliberately do NOT pass upstream's `?format=pdf`. That mode returns a raw
// binary stream, and this client's transport (tunnelFetch → JSON envelope) can
// only carry the base64 form. Our own route's `?format=pdf` is served by
// decoding here-side — see handlers/pegii-reports.ts.
//
// Mirrors pegii-order.gateway.ts / pegii-salesman.gateway.ts.
// ---------------------------------------------------------------------------

import type { ReportGateway } from './report.gateway'
import { createPegiiApiClient, isPegiiNotFound, type PegiiApiClient } from '../lib/pegii-api-client'
import { mapPegiiReportToRecord } from './pegii/pegii-report.mapper'
import type { PegiiReportDto } from './pegii/pegii-report.dto'

export interface PegiiReportGatewayOptions {
  tenantId: string
  baseUrl: string
  apiKey?: string | null
  /** Test seam: inject a stub PegiiApiClient instead of the tunnel-backed one. */
  client?: PegiiApiClient
}

export function createPegiiReportGateway(opts: PegiiReportGatewayOptions): ReportGateway {
  const client =
    opts.client ??
    createPegiiApiClient({
      tenantId: opts.tenantId,
      baseUrl: opts.baseUrl,
      ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
    })

  return {
    async fetchReport(reportType, id) {
      try {
        const dto = await client.get<PegiiReportDto>(
          `/api/v1/pegii/reports/${encodeURIComponent(reportType)}/${encodeURIComponent(id)}`,
        )
        return mapPegiiReportToRecord(dto, { reportType, id })
      } catch (err) {
        if (isPegiiNotFound(err)) return null
        throw err
      }
    },
  }
}
