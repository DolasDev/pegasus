// ---------------------------------------------------------------------------
// pegII-backed OrderGateway — fetches a serialized order ("sale") from the
// pegII team's on-prem domain API via the WireGuard tunnel.
//
// Composes createPegiiApiClient (transport) with mapPegiiOrderToRecord
// (anti-corruption). The serialized resource path is the contract the caller
// gave us: `/api/v1/pegii/serialized/orders/:id`. pegII calls the entity a
// "Sale" internally, but the serialized endpoint's supported entity name is
// "orders", so that is the path segment used here.
// ---------------------------------------------------------------------------

import type { OrderGateway } from './order.gateway'
import { createPegiiApiClient, isPegiiNotFound, type PegiiApiClient } from '../lib/pegii-api-client'
import { mapPegiiOrderToRecord } from './pegii/pegii-order.mapper'
import type { PegiiOrderDto } from './pegii/pegii-order.dto'

/** The serialized-entity name for orders on the pegII API. */
const SERIALIZED_ORDER_ENTITY = 'orders'

export interface PegiiOrderGatewayOptions {
  tenantId: string
  baseUrl: string
  apiKey?: string | null
  /** Test seam: inject a stub PegiiApiClient instead of the tunnel-backed one. */
  client?: PegiiApiClient
}

export function createPegiiOrderGateway(opts: PegiiOrderGatewayOptions): OrderGateway {
  const client =
    opts.client ??
    createPegiiApiClient({
      tenantId: opts.tenantId,
      baseUrl: opts.baseUrl,
      ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
    })

  return {
    async findOrderById(id) {
      try {
        const dto = await client.get<PegiiOrderDto>(
          `/api/v1/pegii/serialized/${SERIALIZED_ORDER_ENTITY}/${encodeURIComponent(id)}`,
        )
        return mapPegiiOrderToRecord(dto)
      } catch (err) {
        if (isPegiiNotFound(err)) return null
        throw err
      }
    },
  }
}
