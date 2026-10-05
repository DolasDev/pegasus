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
import type { PegiiCaller } from '../lib/pegii-request-context'
import { createPegiiApiClient, isPegiiNotFound, type PegiiApiClient } from '../lib/pegii-api-client'
import { mapPegiiSalesmanToRecord } from './pegii/pegii-salesman.mapper'
import type { PegiiSalesmanDto, PegiiSalesmanListPageDto } from './pegii/pegii-salesman.dto'
import { requirePegiiCapabilities, PegiiCapabilities } from '../lib/pegii-capabilities'
import { PegiiApiError } from '../lib/pegii-api-error'

/** The serialized-entity name for salesmen on the pegII API. */
const SERIALIZED_SALESMAN_ENTITY = 'salesmen'

/** The directory list's max page size (movemanager SalesmanListCriteria.MaxLimit). */
const LIST_PAGE_SIZE = 500
/** 50 × 500 = 25k salesmen — far beyond any company; a runaway cursor is a bug. */
const LIST_MAX_PAGES = 50

export interface PegiiSalesmanGatewayOptions {
  tenantId: string
  baseUrl: string
  apiKey?: string | null
  /** Test seam: inject a stub PegiiApiClient instead of the tunnel-backed one. */
  client?: PegiiApiClient
  /** Who is calling (cloud-issued token + x-correlation-id); see lib/pegii-request-context.ts. */
  caller?: PegiiCaller
  /** Test seam: the /version capability gate. */
  requireCapabilities?: typeof requirePegiiCapabilities
}

export function createPegiiSalesmanGateway(opts: PegiiSalesmanGatewayOptions): SalesmanGateway {
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

    async listSalesmen({ active } = {}) {
      await requireCaps(opts.baseUrl, [PegiiCapabilities.SalesmenList], {
        ...(opts.caller ? { correlationId: opts.caller.correlationId } : {}),
      })
      const records = []
      let cursor: number | null = null
      for (let page = 0; page < LIST_MAX_PAGES; page++) {
        const body: PegiiSalesmanListPageDto = await client.get<PegiiSalesmanListPageDto>(
          '/api/v1/pegii/salesmen',
          {
            limit: LIST_PAGE_SIZE,
            ...(active !== undefined ? { active: String(active) } : {}),
            ...(cursor !== null ? { cursor } : {}),
          },
        )
        records.push(...(body.items ?? []).map(mapPegiiSalesmanToRecord))
        if (body.nextCursor == null) return records
        cursor = body.nextCursor
      }
      throw new PegiiApiError(
        'PEGII_API_BAD_ENVELOPE',
        `salesman directory did not end within ${LIST_MAX_PAGES} pages of ${LIST_PAGE_SIZE}`,
      )
    },
  }
}
