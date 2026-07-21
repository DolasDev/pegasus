// ---------------------------------------------------------------------------
// pegII-backed SalesmanGateway — fetches a serialized salesman (employee / sales
// user) from the pegII team's on-prem domain API via the WireGuard tunnel.
//
// Composes createPegiiApiClient (transport) with mapPegiiSalesmanToRecord
// (anti-corruption). The serialized resource path is the contract the caller
// gave us: `/api/v1/pegii/serialized/salesmen/:id`. Mirrors
// pegii-order.gateway.ts.
// ---------------------------------------------------------------------------

import type { SalesmanGateway } from './salesman.gateway'
import { createPegiiApiClient, isPegiiNotFound, type PegiiApiClient } from '../lib/pegii-api-client'
import { mapPegiiSalesmanToRecord } from './pegii/pegii-salesman.mapper'
import type { PegiiSalesmanDto } from './pegii/pegii-salesman.dto'

/** The serialized-entity name for salesmen on the pegII API. */
const SERIALIZED_SALESMAN_ENTITY = 'salesmen'

export interface PegiiSalesmanGatewayOptions {
  tenantId: string
  baseUrl: string
  apiKey?: string | null
  /** Test seam: inject a stub PegiiApiClient instead of the tunnel-backed one. */
  client?: PegiiApiClient
}

export function createPegiiSalesmanGateway(opts: PegiiSalesmanGatewayOptions): SalesmanGateway {
  const client =
    opts.client ??
    createPegiiApiClient({
      tenantId: opts.tenantId,
      baseUrl: opts.baseUrl,
      ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
    })

  return {
    async findSalesmanById(id) {
      try {
        const dto = await client.get<PegiiSalesmanDto>(
          `/api/v1/pegii/serialized/${SERIALIZED_SALESMAN_ENTITY}/${encodeURIComponent(id)}`,
        )
        return mapPegiiSalesmanToRecord(dto)
      } catch (err) {
        if (isPegiiNotFound(err)) return null
        throw err
      }
    },

    async checkReachable() {
      // getHealth hits the unauthenticated `/health` probe; reaching it at all
      // proves connectivity. A tunnel/HTTP failure throws PegiiApiError, which
      // the router maps to 502/503 — the same surface a by-id read produces.
      await client.getHealth()
    },
  }
}
