// ---------------------------------------------------------------------------
// pegII-backed MemoGateway — the site's memo and text-message routes
// (movemanager `MemoEndpoints` / `TextMessageEndpoints`) over the WireGuard
// tunnel:
//
//   POST /api/v1/pegii/orders/{n}/memos                add an order memo
//   GET  /api/v1/pegii/memo-types                      this company's labels
//   POST /api/v1/pegii/text-messages/{id}/read         the desktop store's read mirror
//   GET  /api/v1/pegii/text-messages/{id}/links        conversation → orders/employees
//
// Memo routes are gated on `pegii.memos.v1`, text-message routes on
// `pegii.text-messages.v1`. Ids are validated by the caller before they reach
// a path: order numbers are digits, message ids match PEGII_TEXT_MESSAGE_ID_RE.
// ---------------------------------------------------------------------------

import type { MemoGateway } from './memo.gateway'
import type { PegiiCaller } from '../lib/pegii-request-context'
import {
  createPegiiApiClient,
  isPegiiNotFound,
  PegiiApiError,
  type PegiiApiClient,
} from '../lib/pegii-api-client'
import { requirePegiiCapabilities, PegiiCapabilities } from '../lib/pegii-capabilities'
import {
  PEGII_TEXT_MESSAGE_ID_RE,
  type PegiiCreateMemoResultDto,
  type PegiiMemoTypesDto,
  type PegiiTextMessageLinksDto,
  type PegiiTextMessageReadDto,
} from './pegii/pegii-memo.dto'

export interface PegiiMemoGatewayOptions {
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

export function createPegiiMemoGateway(opts: PegiiMemoGatewayOptions): MemoGateway {
  const client =
    opts.client ??
    createPegiiApiClient({
      tenantId: opts.tenantId,
      baseUrl: opts.baseUrl,
      ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
      ...(opts.caller ? { caller: opts.caller } : {}),
    })

  const requireCaps = opts.requireCapabilities ?? requirePegiiCapabilities
  const require = (capability: string) =>
    requireCaps(opts.baseUrl, [capability], {
      ...(opts.caller ? { correlationId: opts.caller.correlationId } : {}),
    })

  /** Defence in depth: the id goes into a path, and callers validate it first, so a miss is a bug. */
  function messagePath(rcMessageId: string, leaf: 'read' | 'links'): string {
    if (!PEGII_TEXT_MESSAGE_ID_RE.test(rcMessageId)) {
      throw new Error(`not a pegII text message id: ${JSON.stringify(rcMessageId)}`)
    }
    return `/api/v1/pegii/text-messages/${rcMessageId}/${leaf}`
  }

  return {
    async createMemo(orderNumber, body) {
      await require(PegiiCapabilities.Memos)
      try {
        const result = await client.post<PegiiCreateMemoResultDto>(
          `/api/v1/pegii/orders/${orderNumber}/memos`,
          body,
        )
        return { found: true, ...result }
      } catch (err) {
        // Keep pegII's code (ORDER_NOT_FOUND) rather than the boundary's generic NOT_FOUND.
        if (isPegiiNotFound(err) && err instanceof PegiiApiError) {
          return { found: false, code: err.upstreamCode ?? 'ORDER_NOT_FOUND', message: err.message }
        }
        throw err
      }
    },

    async listMemoTypes() {
      await require(PegiiCapabilities.Memos)
      return client.get<PegiiMemoTypesDto>('/api/v1/pegii/memo-types')
    },

    async markTextMessageRead(rcMessageId) {
      await require(PegiiCapabilities.TextMessages)
      return client.post<PegiiTextMessageReadDto>(messagePath(rcMessageId, 'read'), {})
    },

    async getTextMessageLinks(rcMessageId) {
      await require(PegiiCapabilities.TextMessages)
      return client.get<PegiiTextMessageLinksDto>(messagePath(rcMessageId, 'links'))
    },
  }
}
