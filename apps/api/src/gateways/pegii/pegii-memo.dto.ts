// ---------------------------------------------------------------------------
// Wire shapes of the pegII memo and text-message routes (movemanager
// `MemoEndpoints` / `TextMessageEndpoints`; capabilities `pegii.memos.v1` and
// `pegii.text-messages.v1`, NW pulse Phase 7). camelCase as the site sends them.
// ---------------------------------------------------------------------------

/** One desktop order memo (`memos` row, `source='O'`). */
export interface PegiiMemoDto {
  id: number
  orderNumber: number
  /** The stored digit; its label is the company's (see `PegiiMemoTypesDto`). */
  memoType: number | null
  /** `memos.regarding` — the desktop's "Re:", stored uppercased. */
  subject: string | null
  /** `memos.action` — the desktop's "Notes:". */
  text: string | null
  nextAction: string | null
  /** Site-local date, no offset. */
  nextDate: string | null
  callDate: string | null
  /** Site-local, no offset. */
  callTime: string | null
  whoCalled: string | null
  shipper: string | null
  /** Whose "Memos I need to acknowledge" list it is on; 0 = nobody's. */
  personCode: number
  acknowledged: boolean
  createdBy: number
}

/** Body of `POST /api/v1/pegii/orders/{n}/memos`. */
export interface PegiiCreateMemoBody {
  memoType: number
  subject: string
  text: string
  nextAction?: string
  /** `YYYY-MM-DD`; the site defaults it to its today. */
  nextDate?: string
  /** Defaults to the order's coordinator. */
  personCode?: number
  idempotencyKey?: string
}

export interface PegiiCreateMemoResultDto {
  memo: PegiiMemoDto
  alreadyExists: boolean
}

/** `GET /api/v1/pegii/memo-types` — the labels this site's desktop shows. */
export interface PegiiMemoTypesDto {
  /** The company the site's database belongs to (`NW`, `QMM`, …); null when it can't tell. */
  company: string | null
  items: { code: number; label: string }[]
}

/** `POST /api/v1/pegii/text-messages/{id}/read`. */
export interface PegiiTextMessageReadDto {
  messageId: string
  /** False when the desktop's store hasn't archived the message yet. */
  applied: boolean
}

/** `GET /api/v1/pegii/text-messages/{id}/links`. Unknown message → nulls and empty lists. */
export interface PegiiTextMessageLinksDto {
  messageId: string
  conversationId: string | null
  /** The desktop store's `ReadStatus`: 1 read, 2 unread. */
  readStatus: number | null
  /** `recipient_textconversation` Shipper rows (each holds an order number). */
  orderNumbers: number[]
  /** `recipient_textconversation` Driver rows, raw. */
  driverCodes: string[]
  /** `employee_textconversation` rows. */
  employeeCodes: string[]
}

/** The site's own limit (movemanager `TextMessageIds`): 1–100 of `[A-Za-z0-9_-]`. */
export const PEGII_TEXT_MESSAGE_ID_RE = /^[A-Za-z0-9_-]{1,100}$/
