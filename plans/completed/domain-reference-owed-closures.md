# Domain reference — closing what is closable: COMPLETE

**Landed 2026-10-05.** The round selected on one rule — _nothing in it needs a source that does not
exist_ — and it closed every item it set out to close. Its plan was
`plans/in-progress/domain-reference-owed-closures.md`, rewritten as the next round's per this
effort's convention; the live plan is now `plans/in-progress/domain-reference-context-map.md`.

## What shipped

| Item                      | What                                                                                       | Where      |
| ------------------------- | ------------------------------------------------------------------------------------------ | ---------- |
| **C1** `src:nmfta-scac`   | `status: candidate` → `skipped`, with the reason in `notes` and `[A9 §6]` item 2 rewritten | `0fb1bcaf` |
| **C4** `[SD §4.7]` note 5 | Gains `time.delivery`; the register entry struck; `time.departure`'s finding sharpened     | `3a1f9a74` |
| **`documentIssuance`**    | Minted, with `[A8 §5]` **row 17** and `[SD §4.7.1]`'s row; the absent-class entry deleted  | `c573fb8f` |
| **`AWARD`**               | `[A8 §4.3]`'s seventh `boundBy` member, and `[A8 §5]` **row 18** closing `orderResponse`   | `dc6b8741` |
| The cross-area pass       | `[A8 §11]` Revision 9; A1's, A2's and A8's own text corrected in both directions           | `f2c76118` |

Catalog **`0.6.1` → `0.6.2`** — `newRecordType` + `newClosedEnumMember`, both additive, one bump for
two independent deliverables. The second patch-slot bump and the first for a change to the
**vocabulary** rather than to the catalog's own bookkeeping.

**C2 is still open and still the user's.** No source publishes what a signature asserts; `[A6 §6]`
owes it, and minting `documentIssuance` did **not** discharge it.

## What the round found that its own plan did not know

**The plan was wrong about the headline item, and the two biggest findings are corrections to the
documents that handed this round its work.** The plan's own fourth lesson — _a plan is a claim to
audit, not a specification to execute_ — earned its place on the first item read.

- **The seventh `boundBy` member closes ONE authority row, not two.** `[A8 §9 item 8(b-i)]`,
  `[A1 §Cross-area]`(c) and this plan all paired `orderResponse` with `orderCancellation` as "resolved
  by the order's own award". That is true of the **candidate set** and not of the **holder**:
  `[A1 §3.5]`'s own permission table makes a cancellation after acceptance _"either party"_, a refused
  one the counterparty of the requestor, and `[A1 §3.5]`'s open defect leaves a **completed**
  cancellation with no requestor field at all. Plural `authoritative` ⇒ A8-NAMED ⇒ a tie-break
  nothing publishes. `[A1 §8]` scenario 7 reached the same place independently and called it _"the
  honest state"_ — **the contradiction was inside A1 the whole time**, between its §Cross-area and
  its own §3.5 and §8.
- **`[A2 §3.6]`'s `shipmentCommitment` is in `orderCancellation`'s position, not `orderResponse`'s.**
  §3.6 said it was blocked by the enum gap _"and by nothing else"_. Its own sentence names the
  asserter as "the party that **awarded or accepted** the order" — two parties — and its three
  sources answer differently: ADE's `Register` is a push from the awarding side, MilMove runs a
  two-actor submit-then-approve, and §375.403(c) has the **carrier** name and price the lot. The
  schema gap is closed and **who commits** is not.
- **`[SD §4.7]` note 4 quoted five `boundBy` members and the enum had six.** `KEY` was added four
  releases earlier, by the round that wrote `[A8 §4.3]`, and nothing compared the quotation to its
  source — `[SD §4.7.2e]`'s own defect one layer up. Now gated against `BOUND_BY_VALUES`.
- **`[A6 §3.4]`'s state refusal stood on two legs and one has gone.** `documentStateAt` was refused
  partly as `[A2 §3.6]`'s B-STAGE a second time, a fold over records that do not exist. It has an
  input record now. The refusal stands on its other leg — there is no state vocabulary to fold into
  — and the test that asserted the two facts together said in as many words that minting the class
  would be "the reminder that the projection becomes writable". **It fired.**
- **Closing C4 made a second divergence visible, and it is bigger than C4.** `[fork-time §(b)(5)]`
  **decides** that time values are typed — `LocalDate` · `LocalDateRange` · `ZonedInstant`, _"no bare
  ISO strings; no zoneless instants"_ — and the shared layer adopted **none of the three**. So
  `[fork-time §8.1]`'s committed delivery **spread** needed two things to be publishable and C4
  supplied one: its `type` now resolves and its `value` still has nowhere to go. Recorded, not
  closed: a value shape and a primitive is `changedValueShape`, breaking, and owed to `[SD §4.1]`
  and `[SD §4.2]`.
- **Stale counts in six places, none gated.** `[A8 §5]`'s closing observation read "three of
  **eleven** rows have no authoritative role" five rows after the table stopped having eleven, and
  `data/authority-table.json` carried the same pair. `[SD §4.7.1]`'s act-performance row counted
  "seven" and "twelve"; `capture.ts` counted "twelve"; `data/identity-schemes.json` claimed "six
  independent publishers" where its own gate asserts **four** publishing bodies — `[A7 §9]`'s defect
  reproduced inside the one row whose test exists to pre-empt it.

## Transferable lessons

### A gate must read the thing that DECLARES, and "the paragraph" is not it

The cleanup round's lesson was that **scoping** a gate is half the fix. This round found the other
half twice, in the same shape both times: **a gate scoped to a region that contains prose about the
finding closes on that prose.**

1. C4's alias gate was drafted over the whole of `[SD §4.7]`. It passed — because note 5's own new
   paragraph _about_ the `time.departure` divergence names the token. Scoped to §4.7.1's first
   column.
2. The note 4 gate was drafted over note 4's paragraph. It passed — because the sentence explaining
   the gate names `KEY` and `AWARD`. Scoped to the slash-separated enumeration after "A8 §4.3's:".

And a third case of the same family, one level out: **note 5 now describes the `departure` row
without spelling its token**, because writing it would make `[SD]` a document that writes it and
close the register's own finding by prose. The token's single home is the gated register.

### Absence of a TYPE has no type-level witness

`CustodyIsNotAFactClass`'s pattern — `Extract<keyof X, 'name'> extends never ? true : never` — is
sound because it reads `RECORD_TYPES`, a **runtime array**. The same shape over a module
(`keyof typeof model`) enumerates only the **value** namespace, so it cannot see a type alias. The
first draft of `time-value-shape-refuses.ts` held "none of `fork-time`'s three primitives is
published" that way and **survived its tamper**. The claim moved to a reader
(`time-value-shape.test.ts`) that does fail. The false green is kept in the file as its own record.

### `[A6 §9]`'s rule has two halves and the second one is easy to skip

_Gate a recorded gap where it has an edge the types can see, and **say why when it does not**._ The
`ZonedInstant` half has no edge: `TimeValue` is `{at: Instant}`, so a value carrying `zone` beside
`at` is **structurally assignable** — excess-property checking does not apply to a value reaching
the slot through a variable, which is how every real payload reaches it. The zone is **silently
dropped, not refused**, which is worse than the spread's outright impossibility. Found by writing
the refusal and watching it not fire.

### `vitest` does not typecheck, and a register's own shape can be the proof

Striking `time.delivery` left `RECORDED_DIVERGENCES` with one entry, so `direction` inferred to a
single literal and the surviving filter became a comparison `tsc` reports as impossible (`TS2367`).
The union is declared now and **an empty direction stays a direction**, because the register's whole
claim is that it holds the divergences in every direction.

### An ordinal can be accurate and still date the sentence around it

`[A1 §9]` rules out an ordinal that depends on **who** is counting. `A8_KEY`'s "why this is a
**sixth** `boundBy`" is the neighbouring case: `KEY` is the sixth member and still is, so the
ordinal was never false — but "why a sixth?" is a question about an enum with five members, and this
one has six. It depends on **when**. Deleted, with the distinction recorded.

The round also committed the defect `[A1 §9]` does cover, in its own new prose, and the review pass
caught it: `chargeCollection`'s comparison gained "**the fourth kind** has left this list" when the
kind that left is the third in the order that paragraph lists them.

### Run the review pass after the cross-area edits — and read your own commit messages

`[A9]`'s lesson held. The pass ran after the last prose this round wrote, which was the cross-area
pass, and found **four** defects in prose written that same day: a note cell that contradicted
itself in one cell, the ordinal above, an ordinal deleted for a reason that was wrong, and **a count
in the previous commit's own message** ("the third time this round" — it is the second). Amended.

One claim was **checked rather than asserted** and it held: "the first entry to leave `[SD §4.7.3]`'s
absent list by being minted" is true. `owed.counts.absentFactClasses` reads 10 → 13 → 14 → 15 → 16
across the area rounds in `index.json`'s own history, and 15 here — the first decrease.

### Commit before tampering

`git checkout -- <file>` on a tracked file with uncommitted work reverts the work. It cost one
re-application of `00-shared-decisions.md`'s note 5 edits mid-round. A commit is cheaper than a
backup copy, and both are cheaper than retyping.

## State at the end of the round

`specVersion` **0.6.2**. 34 published members (20 act types, 12 other assertion types, 2
meta-records). `[A8 §5]` reaches **18** fact classes by row number, enumerated rather than totalled
in four places that used to carry the number. **13** record types carry an owed authority row, down
from 14. **15** fact classes are named in the corpus and absent from the vocabulary, down from 16 —
the first decrease in the model's history.

Gates: `tsc` silent · 516 tests green · Alloy exits zero on expectations · glossary and catalog are
prettier fixed points and round-trip-validated · `prettier --check` clean over both trees with no
exception.

Every new gate was tampered and watched to fail: the two time-value shape checks, the
`src/`-reading absence reader, the §4.7.1 alias-column gate, the note 4 enumeration gate, the
register in both of its directions, and `MintingActsAreNotBoundToWhatTheyMint` (by binding
`orderAward` to `AWARD`).
