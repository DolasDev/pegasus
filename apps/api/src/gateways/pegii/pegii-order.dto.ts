// ---------------------------------------------------------------------------
// pegII Order DTO — the typed anti-corruption boundary for the serialized
// "order" entity returned by the pegII team's on-prem domain API at
// `/api/v1/pegii/serialized/orders/:id`.
//
// pegII (MoveManager) calls an order a "Sale" internally, so the serialized
// payload is the legacy Sale record. This DTO reflects that legacy vocabulary —
// nested, PascalCase, as legacy .NET serialization emits.
//
// ⚠️ PROVISIONAL CONTRACT — but now anchored to the REAL native shape a partner
// posts to the ingress (the `input.order` the integration-validation corpus and
// the demo_partner mapping read: `Id`, `Survey.SerivceStatus`,
// `InvolvedParties.*`, `KeyMoveDates.*`, `Financials.*`, …). Earlier revisions of
// this file GUESSED a flat shape (`SaleId`, `OrderNumber`, `CustomerName`,
// `ScheduledDate`, …) that does NOT exist on the wire, so every by-id read
// projected an `id: "undefined"` stub (sdk-feedback 0029). The keys below are the
// ones the mapping engine already consumes; the remaining fields (`OrderDate`,
// `ModifiedDate`, `ShipperName`) are best-effort from the pasted real record.
//
// This file and pegii-order.mapper.ts are the ONLY two files that should need to
// change shape-wise when the contract firms up further — everything downstream
// (gateway, factory, handler) is insulated. All fields are optional/nullable so a
// partial payload maps cleanly rather than throwing; the mapper enforces that a
// real `Id` is present and fails loudly otherwise (never an "undefined" stub).
//
// NOTE: `Survey.SerivceStatus` preserves pegII's on-the-wire misspelling of
// "ServiceStatus" — the serializer emits it that way and the mapping reads it
// verbatim; do not "correct" it here or the projection silently stops resolving.
// ---------------------------------------------------------------------------

/** A legacy Identity block: `{ Identity: { Description } }`. */
interface PegiiIdentityRef {
  Identity?: { Description?: string | null } | null
}

export interface PegiiOrderDto {
  /** Legacy Sale id — becomes the OrderRecord id. The one required identity field. */
  Id?: string | number | null
  /** Survey block — carries status and the shipper (customer) name. */
  Survey?: {
    /** Free-form legacy status. NOTE pegII's misspelling; the mapper narrows it. */
    SerivceStatus?: string | null
    /** Shipper / customer display name. */
    ShipperName?: string | null
  } | null
  /** Parties on the move. ShipperEmployer.Identity.Description is the order number. */
  InvolvedParties?: {
    ShipperEmployer?: PegiiIdentityRef | null
    Coordinator?: (PegiiIdentityRef & { EmailAddress?: string | null }) | null
  } | null
  /** Milestone dates, keyed by milestone → `{ Planned, Actual }`. */
  KeyMoveDates?: {
    Survey?: { Planned?: string | null; Actual?: string | null } | null
    Pack?: { Planned?: string | null; Actual?: string | null } | null
    Load?: { Planned?: string | null; Actual?: string | null } | null
    Delivery?: { Planned?: string | null; Actual?: string | null } | null
  } | null
  /** Order/booking date — record creation timestamp. */
  OrderDate?: string | null
  /** Last-modified timestamp. */
  ModifiedDate?: string | null
}
