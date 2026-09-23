/**
 * The core vocabulary of the household-goods moving & storage reference domain.
 *
 * An **executable specification**, not an implementation and not a description of any system we
 * run. Its authority, in precedence order, is
 * `docs/domain-reference/analysis/00-shared-decisions.md` (the binding layer, cited throughout as
 * **[SD §x]**), then `A8-authority-skeleton.md` (**[A8 §x]**), then the three decision documents
 * (**[A3]**, **[fork-order]**, **[fork-time]**).
 *
 * Every rule encoded here cites the section that decided it. Where a document marks something
 * **[ORIGINAL]**, the marker travels with it. Where a document marks something **owed**, it is
 * represented as owed — never guessed to make the types tidy.
 *
 * This package imports nothing from the rest of the repository and has no runtime dependency.
 * Anything that would need product data belongs to a future mapping workstream that has not been
 * authorised.
 */

export * from './primitives'
export * from './ids'
export * from './envelope'
export * from './vocabulary'
export * from './outcomes'
export * from './assertions'
export * from './identity'
export * from './portion'

// Custody is a **projection** ([SD §4.8]), so it is a fold over the records above rather than one
// of them — which is why it sits beside the vocabulary and not inside it.
export * from './custody'

// And the second projection, on the commitment side rather than the goods side ([A1 §3.3]). It is
// the same shape for the same reason: [SD §1.1] forbids a mutable current-state field, so an
// order's stage is a named, versioned fold or it is nothing.
export * from './rules/order-stage'

// And the one rule that is NOT a fold, for the reason [A2 §1] found: the `shipment` aggregate has
// no record of its own coming into existence, so the shipment boundary across an interruption takes
// its discriminant as an input and reports `COMMITMENT_NOT_PUBLISHED` where it cannot.
export * from './rules/shipment-continuity'

// The rules the boundary runs — subject admission ([SD §4.6]) and capture ([SD §5]). They are
// separate from the vocabulary because they are checks *over* it: the vocabulary says what a record
// may be, and these say what may be admitted.
export * from './rules/e-canon'
export * from './rules/capture'

// And the rules the catalog runs once a record is in: who wins ([A8]), what a correction does
// ([SD §6]), and the one value rule the binding layer publishes ([SD §4.4]).
export * from './rules/authority'
export * from './rules/corrections'
export * from './rules/resolution'

// The published contract *around* the vocabulary — what the catalog publishes, at what version,
// with what filter axes and what compatibility promise ([catalog]). It declares no record type: its
// membership **is** `RECORD_TYPES`, and a type-level check keeps the two from drifting.
export * from './catalog'

// The tables that change on their own cadence — [SD §4.7.1]'s canonical subjects, [A8 §5]'s
// authority rows, and the reason vocabulary: its shape from [SD §2.4] and, since [A4 §3], its 23
// members with the per-code discipline no type carries. They live in
// `data/` as JSON and are checked against everything above at load; this module is the loader, and
// it is pure (it is handed parsed JSON and never reads a file).
export * from './data'
