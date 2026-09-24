# Domain reference — the remaining unwritten areas: plan and resumption state

**Written 2026-09-24, after A6 landed**, to be read by a session with **no prior context**.
Everything needed to resume is here or is named by path. Read this whole file before starting.

It replaces `plans/in-progress/domain-reference-areas-a6.md`, which was **deleted** in the A6 PR,
not archived — that round's record is `plans/completed/domain-reference-a6-documents.md`. The
convention in this effort is that a finished round leaves a **record** in `plans/completed/` and its
**plan** is rewritten as the next round's, so do not go looking for an archived copy of a superseded
plan.

**Six deliverables have landed.** Read their records first; each is short and each carries findings
worth not rediscovering:

- `plans/completed/domain-reference-a4-reasons.md` — the reason vocabulary.
- `plans/completed/domain-reference-a8-authority-rows.md` — A8 §5 rows 12-16. Its count of twelve
  corpus-blocked rows is the count **as at that round**; A1, A2 and A6 have all moved it since.
- `plans/completed/domain-reference-a1-order-lifecycle.md` — the `boundBy` gap, and the rule that a
  count in prose is gated or deleted.
- `plans/completed/domain-reference-a5-storage-in-transit.md` — the physical-vs-administrative
  discriminator on authority rows. **Read its hand-off to A6 knowing A6 found it already
  discharged** (§1 of A6's record); the lesson is in §5 below.
- `plans/completed/domain-reference-a2-shipment.md` — the `Exact<>`-is-a-tautology finding, and the
  instruction to every later area to check whether its own central act has a record.
- `plans/completed/domain-reference-a6-documents.md` — **the most recent.** Two refusals, two rules,
  a third kind of authority blocker, and the second consecutive release that changes no published
  byte. §4 item 12 and §5 below both come from it.

**Next deliverable:** **A7** (charges & billing hooks), then A9. §6 says why, and says what makes A7
different from every area written so far.

---

## 1. Where this stands, in one paragraph

A reference domain model of household-goods moving & storage exists, built from external sources
only. Three layers are live: a **research corpus** (`docs/domain-reference/sources/`, 87 sources, 32
analysed), a **binding decision layer** (`docs/domain-reference/analysis/`), and an **executable
specification** (`packages/domain-reference/`) whose glossary and published event catalog are both
generated from the code and gated against drift. The catalog is at `specVersion` **0.5.0**, carries
**two projections** (`custodyAt`, `orderStageAt`) and **three named rules that are neither**
(`shipmentContinuity`, and A6's `documentIdentitySubject` and `CITATION_CLAIMS_NOTHING`). What keeps
it pre-1.0 is the fourteen remaining authority rows — and A6 found that one of the absent classes
needs no prior decision at all, which is the cheapest remaining move in the model.

---

## 2. Current state — all merged to `main`

| What                                   | Where                                                                    | Landed              |
| -------------------------------------- | ------------------------------------------------------------------------ | ------------------- |
| Research corpus + structural decisions | `docs/domain-reference/`                                                 | `34713637`, PR #705 |
| Executable specification               | `packages/domain-reference/`                                             | `5b7c2ccd`, PR #712 |
| Published event catalog                | `docs/domain-reference/catalog/` + `src/catalog.ts`                      | `a4b0bd7f`, PR #713 |
| A4 reason vocabulary                   | `analysis/A4-execution-events.md` + `src/outcomes.ts`                    | `20971ebe`, PR #716 |
| A8 §5 rows 12-16, closing F3 and F5    | `analysis/A8-authority-skeleton.md`                                      | `984200cd`, PR #717 |
| A1, the order & service lifecycle      | `analysis/A1-order-service-lifecycle.md` + `src/rules/order-stage.ts`    | `1b9e5df3`, PR #719 |
| A5, storage-in-transit                 | `analysis/A5-storage-in-transit.md` + `OpensStay` in `src/outcomes.ts`   | `d4fb4c3f`, PR #723 |
| A2, shipment structure                 | `analysis/A2-shipment-structure.md` + `src/rules/shipment-continuity.ts` | `4dbd3b17`, PR #724 |
| **A6, documents & evidence**           | `analysis/A6-documents-evidence.md` + `src/rules/documents.ts`           | _this round_        |

Repo: `github.com/DolasDev/pegasus`, primary checkout `~/repos/pegasus`.

### Gates, all green

`tsc` silent · the vitest suite green · Alloy runner exits non-zero on a counterexample · glossary is
a prettier fixed point · catalog is a prettier fixed point and round-trip-validated.

**No count is written here on purpose** — §4 item 10 is the rule. The commands below produce it in
about five seconds.

```
npm run test      -w @pegasus/domain-reference
npm run lint      -w @pegasus/domain-reference
npm run typecheck -w @pegasus/domain-reference
npm run alloy     -w @pegasus/domain-reference
npm run glossary  -w @pegasus/domain-reference
npm run catalog   -w @pegasus/domain-reference
```

### What is READY to use as a reference

Settled, executable, and gated. Safe to design against today:

- **The envelope and the single classification axis** — `[SD §1.1]`, `[SD §1.3]`. Model-checked.
- **The 33-member record vocabulary**, published as JSON Schema for both faces.
- **The 24-member reason vocabulary** — `[A4 §3]` plus `DEADLINE_LAPSED` at `[A1 §3.6]`.
- **Both remedy shapes** — `newWindow` (`[A4 §3]`) and `opensStay` (`[A5 §3.2]`).
- **Two projections**: `custodyAt` (`[SD §4.8]`) and `orderStageAt` (`[A1 §3.3]`).
- **Three rules that are neither** — `shipmentContinuity` / **B-ONWARD** (`[A2 §3.2]`), and A6's
  **D-ID** (`documentIdentitySubject`) and **D-CITE** (`[A6 §3.2]`, `[A6 §3.5]`). All three take a
  discriminant as an input or are a semantics decision, because nothing publishes one.
- **The shipment boundary across an interruption** and **the storage stay**, both closed.
- **What `evidence[]` means** — a pointer, never a claim (`[A6 §3.5]`). The corpus's one declared
  [ORIGINAL] design decision, now decided.
- **The cross-cutting mechanics**: `(outcome, reason)` factorisation, the Portion, correction
  semantics, the identity key, the capture rules M1–M7, and `[A8 §8]`'s `Instrument`.
- **Seven of thirteen areas written**: A1, A2, A3, A5, A6, A8, and A4 (**vocabulary only** — its own
  scope note says so).

### What is NOT ready

1. **Two of the nine detail areas have no analysis at all**: A7 and A9. `rubric.md`'s note is
   current. (A10–A13 are context-map-only **by design** — not gaps.)
2. **14 of 31 record types carry an owed authority row.** Still the single thing capping the catalog
   at pre-1.0 — see §5, whose shape A6 changed again.
3. **Three owed code vocabularies**: `roleClass`, `unitOfMeasure`, `identityScheme`.
4. **F4 open** in `analysis/findings-from-alloy.md`; 18 declared owed values; **15** fact classes the
   corpus names that the vocabulary does not carry — the newest being `documentIssuance`, whose
   authority row is **already answered** (§5).
5. **`[SD §10.4]` is down to two open bullets.** A2 closed bullet 1; A5 closed bullet 2. What is left
   is the directional stop-type pairs (A3's) and custody authority's owner (A8's).
6. **A1's one open defect stands**: the requestor of a **completed** cancellation has no field,
   because `[SD §2.3]` invariant 2 forbids `reasons[]` at `COMPLETED` and `[SD §4.7.2e]` item 2 puts
   the requestor there. `[A1 §3.5]`, `[A1 §6]`.
7. **A6 opened one defect of its own**, and it is a hole rather than a conflict: **no source publishes
   what a signature asserts.** Four publish the procedure in detail (per line item, per page,
   immutable afterwards, copy before departure) and none the proposition, so there is no value for a
   fact class to carry. `[A6 §3.3(b)]`, `[A6 §6]` — owed to the **user** and to A10.
8. **32 of 87 sources analysed**; 15 registry entries `needs-user`.

---

## 3. Rules that govern this work — binding, not preferences

1. **SCOPE.** An **IDEAL TARGET built from EXTERNAL sources only**. Our own systems are
   `role: mapping-only` in `sources/registry.yaml`. Never cite them for what the domain IS. Partner
   contracts (Weichert, SIRVA ADE, Atlas) ARE external evidence. **A7 has the widest version of this
   trap in the whole corpus** — wider than A2's and A6's, and §6 item 1 is the list.
2. **STANDALONE.** **No product integration.** No legacy lens, no invariants over real extracts, no
   migration sequencing, and **do not ask for native pegII orders**.
3. **DISCLOSURE.** Every claim cites a source that says **that** thing, or is marked **[ORIGINAL]** /
   **[SYNTHESIS]** inline at the point of use.
4. **OWED means owed.** A distinct value, never a null that reads as "nobody", never a guess.
5. **Code is normative for structure; documents are normative for rationale.**
6. **Precedence.** `00-shared-decisions.md` (**[SD]**) outranks everything. Then `[A8]`. Then the
   area documents `[A1]`, `[A2]`, `[A4]`, `[A5]`, `[A6]`, `[A3]`, the forks. Then `[catalog]`.

---

## 4. Landing a change — the recipe A4, A8, A1, A5, A2 and A6 established

Follow this order.

1. Add members to the `as const` array in `src/`, one JSDoc each **carrying a citation or a marker**
   — the disclosure gate reads the docstring, **including on the members of a two-member enum** (A2
   lost a glossary run to two undocumented verdict names; A6 lost one to a single undocumented
   residue reason). A JSDoc must not start with a bold marker, and **markdown emphasis must be `_x_`,
   never `*x*`**, or the glossary stops being a prettier fixed point — A6 hit this in six places at
   once and it is invisible until `npx prettier --check` after `npm run glossary`.
2. Fill the per-member table in `data/` and extend the loader. **Cross-check the two as a set.**
3. Classify the change against `[catalog §2.3]` **before** picking the version — and note that the
   class you need may not exist yet (A5 added `publishedOwedShape`), **or that no class applies
   because nothing published changed** (A2 and A6, and `[catalog §2.4]` now carries two non-bump
   rows).
4. Register new vocabularies in `VOCABULARIES`, new documents in `DOCUMENTS`, and any new **named
   rule or fold** in `RULES` — all three in `tools/generate-glossary.ts`. None is auto-discovered.
   A `RULES` entry may point at a **type** or a **constant**, not only a function (`I-KEY` and A6's
   `D-CITE` are the precedents), so a reading rule can be registered.
5. Bump `CATALOG_VERSION` **only if the emitted schemas changed**, then `npm run glossary` **and**
   `npm run catalog`, then the tests.
6. **Tamper each new gate and watch it fail, then restore.**
7. `npx prettier --check` over `docs/domain-reference` and `packages/domain-reference` **before**
   committing. `packages/domain-reference/alloy/run.mjs` fails this on `main` already — verify that
   with `git show main:` rather than assuming it, which is a ten-second check.
8. **Read the emitted schema diff before classifying the change** — and read it as evidence, not as a
   formality. A2's was empty and A6's was empty, and in A6's case the emptiness **was the
   deliverable**.
9. **A data table may have more than two homes.** The authority table has three.
10. **A COUNT written in prose must be gated or deleted** — `[catalog §5]`'s five are the gated ones.
    **And prefer a gate that _enumerates_ over one that counts**: A6's conformance test lists the
    rows carrying `document` in `context[]`, and that is what caught its own prose saying five when
    the answer is six. A count-only assertion would have passed a wrong number.
11. **An `Exact<>` alias is not a gate until something is assigned to it** (A5) — **and an assigned
    one can still be a tautology** (A2): `Exact<keyof typeof T, K>` over a mapped type over `K` can
    never fail. **An `Exact` earns its place only between two things declared _independently_**, and
    A6 shipped the positive case: `CaptureMethodsAreTheSeven` re-declares `[SD §5.1]`'s seven members
    in A6's own module, so an eighth stops the package compiling.
12. **Gate a recorded gap when the gap has an edge the types can see, and say why when it does not.**
    A6 ships both halves side by side: `CONDITION_BY_OMISSION_IS_NOT_EXPRESSIBLE` is held by the
    `Exact` above, because it is false the moment a capture method is added;
    `DOCUMENT_STATE_IS_NOT_COMPUTABLE` is a plain `= true`, because it is false only when a fact class
    is minted, and a mint already touches three files and a test table. **Do not copy A2's `= true`
    pattern reflexively** — ask first whether the claim has an edge.

---

## 5. The authority rows — the ledger's shape, as A1, A5, A2 and A6 left it

Read `[A6 §Cross-area]` to [A8] and `[A8 §9 item 8]` **(a)–(e)** together. Four areas have now looked
at the ledger and between them they have sorted it into **four** kinds of blocker, in increasing
cost:

- **Blocked on nothing but minting — `[A8 §9 item 8(e)]`, A6's, and the cheapest move left in the
  model.** `documentIssuance`'s authoritative role is **already determined** by an existing `boundBy`
  member: `[A8 §5]` row 10 binds `identity` with `boundBy = SCHEME` (_"the ISSUER of the scheme, and
  nobody else… Authority NEVER moves"_), and `[A6 §3.2]` shows that for the bill of lading — the one
  document kind with a scheme of its own — the party controlling the number scheme **is** the issuer,
  in both published regimes. A row in `[SD §4.7.1]` and a row in `[A8 §5]`, with nothing owed
  underneath either.
- **Blocked on a missing `boundBy` _enum member_ — a schema decision A8 can take today.**
  `orderResponse` and `orderCancellation` (A1), and `shipmentCommitment` (A2). All three want the
  same member: _the role resolved by the order's own award_. Four things wait on it.
- **Blocked on a missing _party entity_ — `[A8 §9 item 1]`.** `partyRole` (§9 items 1-2),
  `notification` (§9 item 6), and A5's three storage classes, whose asserter is a Government
  transportation office or an approving supervisor. **A6 tested A5's physical-vs-administrative
  discriminator and it did not divide A6's acts the way A5 predicted** — see below.
- **Blocked on the corpus.** The nine plan-, membership- and assignment-side rows; `src:dcsa`'s JIT
  `classifierCode` is where to look first (A1). Plus `orderAward`, blocked by A8's own mint principle.

### What A6 did to A5's discriminator, and why it matters for A7

A5 generalised: **the physical acts have closeable authority rows and the administrative acts do
not, and the test is whether the asserter was physically present.** A5 predicted A6 would meet it
again ("who certifies a document").

**A6 found the discriminator is not the operative one in its area.** Issuing a bill of lading is
purely administrative and its row is the _most_ closeable thing A6 found, because the scheme's issuer
is published. Meanwhile the act that _is_ physically present — two parties signing an inventory at a
residence — is the one A6 **could not** record, and not for an authority reason at all: no source
publishes what a signature **asserts**, so there is no value for a fact class to carry.

> **The lesson for A7: run A5's discriminator, and be willing to find it does not apply.** The real
> question is not "was the asserter present" — it is **"does the corpus publish a value for this
> fact, and does it publish who owns the scheme or the instrument that fixes it?"** A7 will meet this
> immediately, because a charge has an amount and the corpus publishes amounts in tariffs A7 is
> explicitly not allowed to model.

### Three pieces of the old `model/` layer are still missing

The context map, the command side, the aggregate lifecycles. The context map is the cheapest and
would help the remaining area work.

---

## 6. THE NEXT DELIVERABLE — A7, then A9

**A7 (charges & billing hooks) is next, and it is the first area whose scope line is a _boundary_
rather than a subject.** The rubric says _"line-haul vs accessorials, charge events, invoice
issued/paid (**detail of rating out of scope**)"_, and A12 (Rating & tariffs) is context-map-only by
design. So A7's central difficulty is not finding evidence — it has more than any area except A2 —
but **deciding where a charge event stops and a rate computation starts**, and doing it without
modelling a tariff.

1. **The scope trap is the widest in the corpus, and it is not the usual one.** Six of our own
   systems publish a charge model — `src:pegasus-cloud-domain` (quote → line items → invoice →
   payments → balance, _"complete and executable"_), `src:pegasus-cloud-prisma` (persisted with
   per-row currency and six timestamps), `src:pegasus-integration-floors` (a
   `financial_settlement` floor with typed `LineItems` and `Totals{Credit,Debit,Net}`),
   `src:pegii-order` (`Survey.CoreCost` plus six add-on components), `src:pegii-longhaul`
   (`total_estimated_linehaul_usd` / `total_actual_linehaul_usd`), and `src:sirva-ade`'s mapping row.
   **All are `mapping-only`.** A2's §2 lists none of its two and says so; A6's §0 item 1 lists all
   four of its and says so. **A7 must do the same, by name, and the list is six long.** This is also
   the area where the temptation is strongest, because our own quote→invoice→payment chain is the one
   piece of our stack that is genuinely well-modelled.
2. **The three inbound hand-offs are real, and one of them is a decision A7 must either ratify or
   overturn.**
   - **`[A2 §Cross-area]` (a): billable weight.** `src:milmove-mymove`'s `billableWeightCap` **with a
     justification field**, `src:uncefact-mmt-rdm`'s `ChargeableWeightMeasure` and
     `src:x12-212-trailer-manifest` element 187's `B` Billed are _"one concept at grade A three times
     over"_, and `[A2 §3.6]` placed it on the **`charge` fact key at `aspect = DECIDED`** rather than
     as a fourth weight basis. **A2 says explicitly that A7 decides whether that holds.** Start here:
     it is the sharpest inherited question in the pile.
   - **`[A1 §Cross-area]`: the pre-commitment proposal.** `[A1 §3.6]` places a price counter-proposal
     on the `charge` fact key at `aspect = PROPOSED`, and warns that `[A8 §5] row 11`'s proposal
     authority is _"now being asked to carry a **pre-commitment** proposal — one made before any order
     exists to hold it — which row 11's `PRINCIPAL` binding may or may not reach."_ That is an
     authority question A7 must answer or explicitly hand to A8.
   - **`[A5 §Cross-area]`: the whole SIT charge surface, deliberately left.** The first-day /
     additional-days / delivery-out triple (`src:dp3-400ng` Items 17.5, 210A-F;
     `src:weichert-supplier-api` odt:561-568; `src:sirva-ade` `SITCFD`/`SITCAD`;
     `src:atlas-world-group-api`'s three billing activity kinds); the re-entry first-day rule
     (Item 17-1.1.b); the accrual-ceases rule (Item 17.7.a-b); the 25% discount after termination
     (Item 17-2); and Item 17.9.b.2's 1,000-lb minimum on the **combined** weight of separately-rated
     portions, which `[A2 §Cross-area]` (c) calls the structural constraint on them. A5 notes
     `[SD §4.7.1]`'s `charge` row **already permits `stay` in `context[]`**, so none of it needs a new
     mechanism.
   - **`[A6 §Cross-area]` to [A7]: two standing rules.** `src:cfr-49-375` §375.519(d), **primary**:
     true copies of all weight tickets must accompany a freight bill _"in order to collect any
     shipment charges dependent upon the weight transported"_ — **a charge that cannot be collected
     without a named document.** Under `[A6 §3.5]`'s **D-CITE** evidentiary standing is a rule over a
     (document kind, fact class) pair and is **not** carried in `evidence[]`, so A7 inherits the pair
     and the rule. Beside it, `src:dp3-tender-of-service` §C.12.a-b's document package as an invoicing
     precondition, and §B.8.a(2)(c)-(d)'s **supplemental invoice refunding a reweigh difference**,
     which is `[SD §6.3]`'s offsetting record with a document attached.
3. **Run A2's and A6's check: does A7's own central act have a record?** It does — **`charge` is a
   declared `type`** — which makes A7 the first area since A4 whose subject is already in the
   vocabulary. But read the row before relying on it: `charge`'s **fact-class family is declared
   `owed`** (the glossary's "Record types whose fact-class family is owed" section — `[SD §4.1]`'s
   table has no row for it), and `chargeValue` is **owed to A11**. So A7 inherits a type with no
   family and no value. That is a third shape, different from A2's (no act) and A6's (no act, but an
   answerable authority), and it should be §1's finding if it holds.
4. **A7's best sources, from the score rows.** Two score `3/3/3` or better on C1–C3:
   - `src:cfr-49-375` **`3/3/3/3/2/1/3/1`, and it is the one A7 source we hold PRIMARY** (a
     `captured/` directory). Line-haul vs accessorial vs additional vs **advanced charges** vs
     impracticable operations vs valuation charge, all defined in Appendix A; and **C3 = 3 for
     arithmetic invariants** — the 100%-binding / 110%-non-binding rule, §375.407's
     relinquish-on-payment rule, §375.705's multi-vehicle rule, §375.707's partial-loss proration.
     Note that §375.505(f) and §375.505(b)(14) put charge-determining fields on the bill of lading,
     which is `[A6 §3.2]`'s carried-identifier territory.
   - `src:milmove-mymove` **`3/3/3/3/2/3/3/2`** — a **six-state payment lifecycle with timestamps**,
     billable work gated on an approved service item, and **70 named pricing params each tagged with
     its origin**. The richest charge _lifecycle_ in the corpus, and grade A with a capture.
   - `src:dp3-400ng` **`3/3/2/3/2/2/2/2`** — the full linehaul/non-linehaul split with the formula,
     two discounts filed per channel, ~50 item codes with OT variants, pre-approval as a billing
     precondition. **This is the source A7 must read carefully and cite narrowly**, because it is a
     tariff and A12 is out of scope: take the _structure_ (a charge has an item code, a basis and a
     pre-approval state) and leave the _rates_.
   - `src:alvys-api` **`3/3/2/0/2/3/3/2`** — the linehaul-vs-accessorial split **as structure rather
     than a code list**, which is the shape decision A7 has to make. C4 = 0.
   - `src:dp3-tender-of-service` **`2/2/2/2/2/1/3/0`**, grade **A** — charge _events_ rather than
     rating: pre-approval of every accessorial before performance, DD 619 as customer-signed billing
     evidence, supplemental invoices, and PPSO denial of SIT charges as a **notification penalty**.
     C7 = 3 for the attribution-and-set-off pattern. **Do not omit this source the way the A6 plan
     did** — see §7.
   - `src:smartmoving-api` **`3/2/1/3/1/2/3/2`** — 13 `JobChargeCategory` values giving the split **in
     a mover's terms**, and the only C4 = 3 in the area.
   - `src:milmove-docs` **`2/2/3/2/1/2/2/1`** — C3 = 3 for an actor-by-actor invoicing walk with
     validation gates, no-double-billing and no-overlapping-request rules.
   - Also: `src:nmfta-ebol` (`payment.terms` Prepaid/Collect/Third Party, a full `billTo` party with
     its own account number, a 28-code accessorial list), `src:stedi-x12-reference` (the 210's
     `B3`/`L0`/`L1`/`L7`/`L9`/`L3`/`ITD`/`C3` chain), `src:uncefact-scrdm` (`Financial_Adjustment` as
     an entity separate from `Delivery_Adjustment` — already cited at `[SD §6.3]`).
   - **Absent, and the absences are informative**: `src:shippeo`, `src:open-trip-model` (_"no money
     anywhere in the spec"_) and `src:macropoint` score **0**. `src:samsara` and `src:project44` score
     1. Every telematics and visibility source has nothing, which is the mirror of their A4 strength.
5. **Watch for this specific trap.** `[SD §6.3]` already decides that **financial facts are corrected
   only by an offsetting record, never by retraction**, and `FINANCIAL_FACT_CLASSES = ['charge']`
   enforces it **in the type** — a `Correction` against a `charge` does not compile, and
   `OffsettingRecord` is the only door. A7 must not reopen that; it should check whether the door is
   wide enough for the three things the corpus names (refunds, reimbursements, re-bills as _"additional
   coded transactions carrying a narrative note"_ — `src:dp3-400ng` Items 4.12, 4.13.3.b, 17-2.7,
   27.4.b-c) and say so.

**Pattern to follow:** `analysis/A6-documents-evidence.md` and `analysis/A2-shipment-structure.md`
are the two closest models. **A6's §1 is the one to copy for the opening** — it audits what is owed
to the area **by name and against the code**, and its first two findings are that one owed item was
already discharged and that the plan's own source list omitted the area's strongest source. **Do that
audit before trusting this file's §6.** A6's §2 is the model for a source survey that marks
**primary vs secondary** per source (`[A6 §0]` item 4 is the rule, and only `cfr-49-375` was primary
for A6 — the same will be true for A7). A2's §3.3 is the model for a refusal argued from a facet
analysis; A6's §3.6 is the model for a mapping whose **residue** is the finding; and A6's §3.8 is the
model for triaging a rubric row and discovering most of it belongs elsewhere.

Start §1 by grepping the glossary's Owed section, `[SD §10.4]` and every landed area's
`§Cross-area` for the area's id, **and grep `packages/domain-reference/src/` for `A7`** — A6 found
three live TODOs and one test titled `FINDING:` waiting for it, and that was the round's cleanest
deliverable. The rubric — 13 areas, 8 criteria, evidence grades — is `docs/domain-reference/rubric.md`,
which now also carries A2's observation that an operation can be scored in one area and live in
another, and A6's warning that the `Covers` column is a prompt rather than an inventory.

---

## 7. How to work here — hard-won, and worth keeping

### Verification discipline

- **Run the gates yourself. Never trust a report.**
- **Prove a gate bites by tampering.** A false green is worse than a red. A5 shipped a compile-time
  assertion that did nothing; A2 shipped one that could never fail even though it was assigned; A6's
  tamper of a documentation gate revealed it passes a **half-tamper**, because it is a substring
  search over a section rather than over the bullet it looks like it checks. Only the tamper found
  any of the three.
- **Prefer a gate that enumerates over one that counts.** §4 item 10.
- **Read the existing tests for the records you are writing about.** An `OWED` label or a test title
  naming your own area is a to-do item in the test suite. A2's was a scenario title; **A6's was a
  test called `FINDING: the inbound message cannot ride in a published evidence[]`**, and turning it
  into the decision was the round's cleanest deliverable.
- **Check whether the source captures exist before planning to quote primary text.** Only
  `atlas-world-group-api`, `cfr-49-375`, `dcsa`, `gs1-epcis-cbv`, `gtfs`, `milmove-docs`,
  `milmove-mymove` and `x12-212-trailer-manifest` have a `captured/` directory. `dtr-part-iv`,
  `dp3-400ng`, `dp3-tender-of-service`, `sirva-ade`, `samsara`, `nmfta-ebol`, `smartmoving-api`,
  `project44`, `shippeo`, `open-trip-model` and `weichert-supplier-api` are **analysis-only**, so
  every quotation from them is secondary. **Say so per source, as `[A6 §0]` item 4 and `[A6 §2]` do**
  — and note that **evidence grade is not the same as having a capture**: `dp3-tender-of-service` is
  grade **A** (read cover to cover) with no capture, and `dtr-part-iv` is grade **B**. Comparing score
  rows without reading grades is how the A6 plan left the area's strongest source off its list.
- **`grep` here is a ugrep wrapper with `-I`, and one NUL byte makes it skip a file silently.**
  `generate-glossary.ts` and `tests/conformance/documents.test.ts` both hold literal NULs. **When a
  negative grep result is load-bearing, use `/usr/bin/grep -a`.** Recorded in
  `dolas/agents/project/GOTCHAS.md`. A6 hit it on the first attempt to read the `RULES` registry.
- **`vitest` does not typecheck.** A6 had a green suite with two type errors in its own new test
  file. Run `npm run typecheck` after every test edit, not only after a `src/` edit.
- **The same trap has a `gh` shape.** `mergeQueueEntry` is not a valid `gh pr view --json` field.
  Queue state comes from GraphQL.
- **Verify AFTER the pre-commit hook, not before.** It runs `eslint --fix` + `prettier --write` and
  folds the result into the commit.

### Working with the generators

Both live in `packages/domain-reference/tools/` and read `src/` through the **TypeScript compiler
API**. If you extend either:

- **Prettier must run inside the generator.** `JSON.stringify(x, null, 2)` is not a fixed point.
- **`anyOf`, never `oneOf`** when rendering a TypeScript union.
- **`aliasSymbol` is lost when a distributive conditional is instantiated.**
- **`checker.getUnionType` is internal API** — it runs and does not typecheck.
- **A JSDoc must not start with a bold marker**, every member of every registered vocabulary needs
  one however obvious the name, and **emphasis must be `_x_`, never `*x*`** (§4 item 1).
- A new analysis document is gated automatically: `tests/conformance/documents.test.ts` scans every
  `.md` in `analysis/`, so any `` `type = X` `` span must name a real vocabulary member — write a
  rejected candidate in prose, never in a code span. To make a `[yourdoc §x]` citation link, add it
  to `DOCUMENTS`. It also holds every published reason code to being named by `[A4]`, and every
  member of `ABSENT_AND_OWED` to being named in `[SD §4.7.3]` by a phrase recorded in `AS_WRITTEN`
  — so adding an absent class is a **two-file** change plus a test-table entry.
- **The published schema is not the same as the data table.** A6's D-ID cost no version bump because
  `record.identity`'s `context[]` is emitted as the whole `anyAggregate` family — the narrower
  `context` list in `data/canonical-subjects.json` is documentation of the row, **not a published
  constraint.** Check the emitted schema before assuming a data-table edit reaches a consumer.

### Workflows and CI

- **Parallel authoring causes drift.** Settle a shared layer FIRST, then fan out. Keep a workflow
  under ~6 agents when each does heavy reading.
- **CI runners are slower than this machine.** `testTimeout` covers test **bodies** only —
  `beforeAll` needs `hookTimeout`.
- **Betterleaks scans full history**, so removing a file in a later commit does not help — amend.
- **Dependency Review** reads any `package.json` in the diff, **including inside captured
  third-party material**.
- **`new-worktree.sh` rewrites `apps/e2e/.env.test`** with the worktree's Postgres port. It is
  tracked, so it shows up as a modification — `git checkout -- apps/e2e/.env.test` before committing.
- **Extractors:** `pdf2txt.py` / `odt2txt.py` are **gone**. Recreate if source PDFs/ODTs must be
  re-read (pypdf in a venv; ODT is a zip containing `content.xml`). No poppler on this machine. A
  captured XML can be read with a small `re`-based tag-stripper — that is how A6 quoted
  `cfr-49-375` §375.505 verbatim.
- **Worktree slugs collide on the derived Postgres port.** `new-worktree.sh` computes it as
  `5433 + (sum of the slug's character ordinals) % 60`, so two unrelated names can land on one port.
  It fails **after** creating the worktree and branch, leaving partial state that
  `scripts/rm-worktree.sh <slug>` clears. Compute it and check it is free before choosing a slug:
  `python3 -c "s='<slug>'; print(5433 + sum(ord(c) for c in s) % 60)"`.

---

## 8. Housekeeping left over

- **Separate repo, unrelated to this plan** — `~/repos/pegasus-workflows`,
  `platform/integrations/weichert/rules.json`: six rules carry `sourceRef: "Weichert API: …"` quoting
  sentences that appear nowhere in `weichert-api.odt`. Confirmed by the user: they came from
  **observed API error responses**. Reword them, and fix the packed-but-not-loaded dead end —
  `pre-in-progress-forbids-pack-actual` (a Pegasus-added rule) combined with Weichert's real
  load-actual requirement leaves no valid status for a shipment packed but not yet loaded. Live in
  GLOBAL and the `nw` tenant.

---

## 9. Starting the next session

```bash
cd ~/repos/pegasus && git fetch && git pull --ff-only    # primary checkout, parked on main
python3 -c "s='a7-charges'; print(5433 + sum(ord(c) for c in s) % 60)"   # check that port is free
scripts/workstream-start.sh feat a7-charges plans/in-progress/domain-reference-areas-a7.md
```

Then work in the new worktree; commits land with the implementation as **one PR**, and the plan is
archived to `plans/completed/<slug>.md` **before** opening it.

> **Two things about `workstream-start.sh`.** It **copies** the plan to
> `plans/in-progress/<slug>.md` inside the worktree, so the worktree ends up with **two** copies —
> the seeded one and this file. Do not edit both. The pattern that worked four times: write the new
> record at `plans/completed/domain-reference-a7-<slug>.md`, write the **next** round's plan as a new
> `plans/in-progress/domain-reference-<next>.md`, then delete the seeded copy and remove this file.
> And the script provisions Postgres **after** creating the worktree and branch, so a port collision
> fails late and leaves partial state — `scripts/rm-worktree.sh <slug>` cleans it up.

**Read before writing anything:**

1. `plans/completed/domain-reference-a6-documents.md` — the most recent, and the source of §4 items
   10 and 12, §5's fourth blocker kind, and the discipline of auditing what is owed against the
   **code** rather than against a plan.
2. `docs/domain-reference/analysis/A6-documents-evidence.md` — the closest model for an area whose
   honest output is mostly refusals, and for a source survey that marks primary vs secondary per
   source. §1, §2 and §3.8 are the three sections to copy.
3. `docs/domain-reference/analysis/A2-shipment-structure.md` — the model for a refusal argued from a
   facet analysis, and where A7's billable-weight question is written down.
4. `docs/domain-reference/glossary.md`, the **Owed** section — the honest state, always current.
   `charge`'s two entries (a `chargeValue` owed to A11, and a fact-class **family** owed) are §6
   item 3.
5. `docs/domain-reference/analysis/00-shared-decisions.md` §6.3 (**the offsetting-record rule, which
   A7 must not reopen**), §4.7.1's `charge` row (`stay` is already permitted in `context[]`), §10.4
   (two open bullets, both other areas') and §4.7.3 (the absent classes).
6. `docs/domain-reference/analysis/published-event-catalog.md` §2.3, §2.4's **two non-bump rows** and
   §5 — what is promised to consumers, and what changing a role name's spelling costs (**breaking, a
   new major**).
