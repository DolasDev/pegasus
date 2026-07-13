// ---------------------------------------------------------------------------
// pegII Order DTO — the typed anti-corruption boundary for the serialized
// "order" entity returned by the pegII team's on-prem domain API at
// `/api/v1/pegii/serialized/orders/:id`.
//
// pegII (MoveManager) calls an order a "Sale" internally, so the serialized
// payload is the legacy Sale record. This DTO reflects that legacy vocabulary.
//
// ⚠️ PROVISIONAL CONTRACT. The pegII serialized shape is still being firmed up.
// Fields are best-effort guesses (PascalCase, as legacy .NET serialization
// emits) and are NOT a confirmed contract. This file and pegii-order.mapper.ts
// are the ONLY two files that should need to change shape-wise when the real
// contract lands — everything downstream (gateway, factory, handler) is
// insulated from it. All fields are optional/nullable so a partial payload maps
// cleanly rather than throwing.
// ---------------------------------------------------------------------------

export interface PegiiOrderDto {
  /** Legacy Sale id — becomes the OrderRecord id. */
  SaleId: string | number
  /** Human-facing order/sale number (e.g. "SO-1234"). */
  OrderNumber?: string | null
  /**
   * Legacy sale status. Free-form on the wire; the mapper narrows it to the
   * OrderRecord union ('booked' | 'in_progress' | 'completed').
   */
  Status?: string | null
  /** Customer/account display name. */
  CustomerName?: string | null
  /** Scheduled move date (ISO 8601 or legacy date string). */
  ScheduledDate?: string | null
  /** Actual packing date, when packed. */
  PackingActualDate?: string | null
  /** Record creation timestamp. */
  CreatedDate?: string | null
  /** Last-modified timestamp. */
  ModifiedDate?: string | null
}
