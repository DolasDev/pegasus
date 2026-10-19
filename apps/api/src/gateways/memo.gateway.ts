// ---------------------------------------------------------------------------
// MemoGateway — order memos and the desktop's text-message store, both on the
// tenant's pegII site (NW pulse Phase 7). See pegii-memo.gateway.ts for the
// implementation and memo-gateway.factory.ts for how a tenant resolves to one.
//
// Memo calls require `pegii.memos.v1`; text-message calls `pegii.text-messages.v1`.
// ---------------------------------------------------------------------------

import type {
  PegiiCreateMemoBody,
  PegiiCreateMemoResultDto,
  PegiiMemoTypesDto,
  PegiiTextMessageLinksDto,
  PegiiTextMessageReadDto,
} from './pegii/pegii-memo.dto'

export type MemoCreateOutcome =
  | ({ found: true } & PegiiCreateMemoResultDto)
  /** pegII's 404, with its code (`ORDER_NOT_FOUND`). */
  | { found: false; code: string; message: string }

export interface MemoGateway {
  /**
   * Add a memo to an order. The site validates (its 400 passes through as a
   * PegiiApiError) and owns idempotency: the same `idempotencyKey` with the same
   * request answers `alreadyExists`; with a different request, 409.
   */
  createMemo(orderNumber: number, body: PegiiCreateMemoBody): Promise<MemoCreateOutcome>

  /** The memo-type labels this site's desktop shows. */
  listMemoTypes(): Promise<PegiiMemoTypesDto>

  /** Mirror "read" into the desktop's store. RingCentral stays authoritative. */
  markTextMessageRead(rcMessageId: string): Promise<PegiiTextMessageReadDto>

  /** The message's conversation and the orders/employees it is linked to. */
  getTextMessageLinks(rcMessageId: string): Promise<PegiiTextMessageLinksDto>
}
