# Domain reference — A8's authority rows: five closed, fourteen explained

**Landed 2026-09-23.** Deliverable 1 of `plans/in-progress/domain-reference-a8-and-areas.md`. The
area comparisons (deliverable 2) were **not** started and carry forward there.

## The headline, and it is not the count

The ledger said **19 of 31** record types had an owed authority row, and the plan expected closing them
to "unblock scoring in **every** area". That expectation was wrong, and finding out why is the more
useful half of this work.

**Five rows are now written** — the five the corpus supports. **Twelve of the remaining fourteen are
blocked on the corpus, not on effort**: no external source binds a plan change, a membership offer, an
assignment or an order award to an asserting role. Writing rows for them would have moved the count
without moving the capability, because `[SD §4.7]` note 3 and `[A8 §10]`'s last row both bar a
**provisional** reading from scoring a dependent decision. `[A8 §9 item 8]` used to read as a to-do
list; it now separates the two reasons a row can be missing. **Only two of the fourteen are owed to
A8 itself**: `partyRole` and `notification`.

## What shipped

`[A8 §5]` gains rows **12-16**, at `capped-medium`, across all three homes of the table
(`data/authority-table.json`, `AUTHORITY_TABLE` in `src/rules/authority.ts`, and the authority column
in `data/canonical-subjects.json`).

| Row | Type           | `boundBy` | The point                                                    |
| --- | -------------- | --------- | ------------------------------------------------------------ |
| 12  | `handover`     | **`KEY`** | **F3 closed.** A sixth binding.                              |
| 13  | `weight.gross` | `CUSTODY` | The weighing party; `weighMaster` is evidence, not asserter. |
| 14  | `weight.tare`  | `CUSTODY` | `sameAs` 13.                                                 |
| 15  | `packing`      | `CUSTODY` | The mirror of row 3; `customer` competes on scope.           |
| 16  | `pieceCount`   | `CUSTODY` | The away-from-boundary half; row 9 keeps the boundary.       |

**F3 and F5 are both resolved.** Only **F4** remains open.

## The decisions worth remembering

- **`boundBy = KEY`, and why it is a sixth member rather than `NONE` plus a tie-break.** Under `NONE`
  _no_ role is authoritative and a value rule settles the fact (row 6). For `handover` **exactly one**
  role is authoritative and it is computable from the record, so `authoritative` is neither empty nor
  plural, **A8-NAMED never fires**, and there is no value rule to name. Calling it `NONE` would have
  meant inventing one.
- **It is non-circular because it reads the fact KEY, not the fold.** `[SD §4.8.2]` refused a `CUSTODY`
  binding here because "A8-MOVE would be defined in terms of the thing it defines".
- **The general principle, which is the lasting half: an act that MINTS the thing a binding follows can
  never be bound to that thing.** `handover` mints custody → not `CUSTODY`; `assignmentOffer` mints the
  assignment → not `ASSIGNMENT`; `orderAward` mints the principal relation → not `PRINCIPAL`. F3 was
  the first instance of a class, not a special case.
- **`KEY` rescues `handover` alone, and the reason is mechanical.** Only `handover` names its actor in
  the **qualifier**. The nine lifecycle acts name theirs in **`context[]`**, and `[SD §1.4]` rule 1
  forbids resolution from keying on `context[]`. Moving them into a qualifier is
  `changedQualifierShape` — **breaking, a new major**. So the provisional two-sided reading
  `[SD §4.7.1]` carries has no legal mechanism; that is why it says "Do not score on this".
- **F5: lower-camel is canonical and a role name is case-significant on the wire.** A8-NAME-1 is a
  _rule_, the ADE cast is a _citation_. `[A8 §7.6]`'s worked records carried the capitalised spelling
  **inside a qualifier** — the defect itself, not an example of it — and are corrected.

## Two things the count taught, both worth keeping

1. **`authorityRows` did not budge from 19 until all three homes of the table agreed.** JSON rows and
   the typed `AUTHORITY_TABLE` were done; the generated inventory reads
   `canonical-subjects.json`'s authority column, which was still `owed`. **Check the count.**
2. **`specVersion` went `0.2.0` → `0.3.0`, and the reasoning nearly went the other way.** `boundBy` is
   on no record and `KEY` reaches the wire nowhere, so the change looked internal. But A8-KEY needed a
   new `AuthoritativeHolder` member, `ObligationRecipient` references it, and the emitted schemas
   publish it — `newClosedEnumMember`, additive. **It was the schema diff that said so**, not the
   reasoning. A compatibility claim argued from which fields _feel_ published is waiting to be wrong.

Also found: `BOUND_BY` (`rules/authority.ts`) and `BOUND_BY_VALUES` (`data.ts`) were **one enum in two
places with no cross-check** — the defect the reason vocabulary had one layer down. Adding `KEY` meant
editing both and nothing would have caught editing only one. Now guarded by `Exact<>`, tamper-proved.

## Gates

`tsc` silent · **307 tests in 18 files** · lint clean · Alloy: **A8-KEY is transcribed and
model-checked**, with `Handover` gaining the `assertedBy` role a rule finally reads. Two new commands:
one shows A8-KEY settling the two-sided contest F1 made routine, the other shows what it costs — where
only the side the key does _not_ name asserted, A8-KEY selects **nothing**, so the fold goes quiet for
a reason distinct from "nobody asserted". Every new gate was tamper-proved and restored.

## Still owed after this

- **Two rows, to A8:** `partyRole` (§9 items 1-2 — party entity and role enum) and `notification`
  (§9 item 6 — a role resolved to a contactable address).
- **Twelve rows, to the corpus.** They need an external source that attaches authority to a plan
  change, a membership offer, an assignment or an order award. None exists today.
- **F4** — `ExternallyPerformedLeg.performedBy` has no consumer. Untouched; it is a fold question, not
  a row.
- **A4's requirement on A8:** `roleClass` still needs an explicit **non-party** member, for
  `FORCE_MAJEURE` and `CAUSE_UNKNOWN`.
