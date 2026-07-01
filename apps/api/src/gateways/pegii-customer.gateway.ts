// ---------------------------------------------------------------------------
// pegII-backed CustomerGateway — hydrates domain Customers from the pegII
// team's on-prem domain API via the WireGuard tunnel.
//
// Composes createPegiiApiClient (transport) with mapPegiiCustomerToDomain
// (anti-corruption). The pegII API resource paths/query names used here
// (`/customers`, `/customers/:id`, `/customers/count`) are PROVISIONAL and will
// be reconciled with the real contract alongside pegii-customer.dto.ts.
// ---------------------------------------------------------------------------

import type { CustomerGateway } from './customer.gateway'
import { createPegiiApiClient, isPegiiNotFound, type PegiiApiClient } from '../lib/pegii-api-client'
import { mapPegiiCustomerToDomain } from './pegii/pegii-customer.mapper'
import type { PegiiCustomerDto } from './pegii/pegii-customer.dto'

/** Owning-user placeholder — pegII has no cloud user concept (see mapper). */
const PEGII_PLACEHOLDER_USER_ID = 'pegii-system'

export interface PegiiCustomerGatewayOptions {
  tenantId: string
  baseUrl: string
  apiKey?: string | null
  /** Test seam: inject a stub PegiiApiClient instead of the tunnel-backed one. */
  client?: PegiiApiClient
}

export function createPegiiCustomerGateway(opts: PegiiCustomerGatewayOptions): CustomerGateway {
  const client =
    opts.client ??
    createPegiiApiClient({
      tenantId: opts.tenantId,
      baseUrl: opts.baseUrl,
      ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
    })

  return {
    async findCustomerById(id) {
      try {
        const dto = await client.get<PegiiCustomerDto>(`/customers/${encodeURIComponent(id)}`)
        return mapPegiiCustomerToDomain(dto, PEGII_PLACEHOLDER_USER_ID)
      } catch (err) {
        if (isPegiiNotFound(err)) return null
        throw err
      }
    },

    async findCustomerByEmail(email) {
      const dtos = await client.get<PegiiCustomerDto[]>('/customers', { email })
      const first = dtos[0]
      return first ? mapPegiiCustomerToDomain(first, PEGII_PLACEHOLDER_USER_ID) : null
    },

    async listCustomers(opts2 = {}) {
      const dtos = await client.get<PegiiCustomerDto[]>('/customers', {
        limit: opts2.limit ?? 50,
        offset: opts2.offset ?? 0,
      })
      return dtos.map((d) => mapPegiiCustomerToDomain(d, PEGII_PLACEHOLDER_USER_ID))
    },

    async countCustomers() {
      const { total } = await client.get<{ total: number }>('/customers/count')
      return total
    },
  }
}
