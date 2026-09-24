# Domain reference — A6, documents & evidence: COMPLETE

**Landed 2026-09-24.** The deliverable of `plans/in-progress/domain-reference-areas-a6.md` — the
fourth of the unwritten area comparisons, after A1, A5 and A2. A7 and A9 carry forward in
`plans/in-progress/domain-reference-areas-a7.md`.

## The headline

**A6's central output is two refusals, a reading rule, and a release that changes no published
byte — and the non-bump is the deliverable rather than a side effect.**

A2 changed nothing on the wire because its output happened not to reach it. A6 changed nothing
because **reaching the wire was the cost it declined to pay**: `[A6 §3.5(c)]`'s decision is
explicitly a refusal to widen `EvidenceRef`, published with `additionalProperties: false` on both
branches, and `[A6 §3.2]`'s rule files an assertion the schema **already admits**.

The area also ran [A2 §3.6]'s check one aggregate over and got the same answer with one important
difference. **The `document` aggregate is a subject with no facts and an object with no acts** — no
row of `[SD §4.7.1]` records a document being issued, signed, corrected or cancelled — but
`documentIssuance`'s **authority is already answered**, and that makes it a third kind of blocker.

The deliverable is `docs/domain-reference/analysis/A6-documents-evidence.md` (≈1400 lines), two named
rules, one absent fact class, one compile-time gate, and **no version bump**.

## The seven owed items, and how each closed

| #   | Owed by                                                                      | Settled                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `[SD §7.1]`; the `identity` row's two `document` positions                   | Rule **D-ID**. An identifier **assigned to the form** is an `identity` about the `document`; one the document **carries** is about that identifier's own subject           |
| 2   | `[A2 §Cross-area]`'s instruction to run the check                            | **No act on a document has a record.** `documentIssuance` absent and owed — with its authority row **already determined** by `boundBy = SCHEME`                            |
| 3   | `src:dtr-part-iv`'s own recorded limit; `[SD §1.2]`                          | **Refused**, and the projection refused harder — a `documentStateAt` would be **B-STAGE again**                                                                            |
| 4   | `[fork-time §5.6]`; two live TODOs; a test titled `FINDING:`                 | Rule **D-CITE** — a citation is a pointer, never a claim. `EvidenceRef` **not widened**; `e-canon.ts`'s ingest-local widening ratified                                     |
| 5   | `[A2 §Cross-area]`; `[fork-order §6]` q5; `authority.ts`'s `Instrument` TODO | **No new mechanism.** `[A8 §8]`'s `Instrument.grants` already carries it; A6 supplies the mapping, and the mapping **changes the TODO's question**                         |
| 6   | `[A5 §Cross-area]`                                                           | **Already discharged by [A8 §5] row 9 before A6 opened it.** What survived is not a `condition` question — it is a capture-method gap, handed to A4                        |
| 7   | the rubric's A6 row                                                          | Eight items: **two are A6's**, four are other areas' or already carried as `context[]`, two are `evidence[]` itself. One ("order for service") is not in the corpus at all |

## The decisions worth remembering

- **`identity` could always take a `document` as its subject, and nobody had noticed.** Its declared
  family is `anyAggregate` — `[SD §7.1]`'s _"subject may be ANY aggregate kind"_ — so the model has
  admitted assertions **about** documents since the shared layer was written and has never said which
  ones. It matters because `[SD §1.3]` pairs on `(subject, type, qualifier?)`: a bill-of-lading number
  filed against the shipment and against the document are **two fact keys**, so the duplication is
  invisible. D-ID is a reading rule, not a schema change, and it **costs no published byte**.
- **`src:cfr-49-375` §375.103, primary: _"Bill of lading means both the receipt and the contract."_**
  The artefact carries two facts of different kinds at once. A2's B-ONWARD read DTR #81, which
  defines it as the contract only; the receipt half is A6's, and it is the sourced reason `document`
  has to be an aggregate rather than an attribute of either side.
- **Running D-ID over the corpus, `undetermined` is the normal case.** Six document kinds; **one
  verdict of `DOCUMENT`, and it is the bill of lading in two regimes.** The weight ticket has no
  number of its own in §375.519(a)'s six items; the inventory numbers **each article**, not the
  document. That makes D-ID narrow and correct rather than broad and speculative.
- **`documentIssuance` is a third kind of blocker, and the cheapest of the three.** A5's storage
  classes are blocked on a missing party entity; A2's and A1's three on a missing `boundBy` member.
  This one is blocked on **minting alone**: `[A8 §5]` row 10 binds `identity` with
  `boundBy = SCHEME`, and for the one document kind with a scheme of its own the party controlling
  the number scheme **is** the issuer, in both regimes. §375.103 defines a
  `Government bill of lading shipper` separately from a `commercial shipper` because the carrier's BL
  and the GBL are two instruments, each issued by the party whose instrument it is — **so the two
  publishers naming different issuers is not a conflict.** A8 is asked to accept a reading, not to
  close a gap.
- **A signature is a distinct act and is deliberately NOT on the absent list.** The tempting shortcut
  reads it as `handover` — §375.505(f) has the BL signed at both ends, exactly where the custody
  boundaries are — and the same subsection refutes it: §375.505(h) signs it **three days before
  loading**, and §375.505(g)(2) permits signing an **incomplete** document. It is omitted for a
  reason that is not the usual one: four sources publish the **procedure** and none the
  **proposition**, and a fact class needs a value.
- **Document state refused on the A2 §3.3 pattern, with more publishers.** Eleven publishers, at
  least twelve facets, no two decompositions agreeing — and `src:sirva-ade` demonstrating the fusion
  in a live grade-A contract by publishing **"Bill of Lading" and "Bill of Lading SIGNED" as two
  separate document _types_**. The projection was the worse temptation, not the safer one.
- **The correction regime needed no new mechanism, and finding that was the work.** `[A8 §8]`'s
  `Instrument.grants` already cites Table A-402-4 as its precedent. A6 mapped the whitelist's eight
  rows and **four of the eight fields are not facts this model carries at any grain** — the
  addresses need `placeRef` (owed), the agent code needs `partyRole`'s row (owed), the Code of
  Service needs the `shipmentType` **[A2 §3.3] withdrew on evidence**, and accounting codes and
  remarks are not domain facts. So the whitelist is not coarse for want of a sub-fact grain;
  inventing one would move none of the four. `authority.ts`'s TODO is **taken**, not sharpened.

## Two §1 audit findings, which is now a three-round pattern

1. **Owed item 6 was already discharged.** `[A5 §Cross-area]` hands A6 `src:dp3-400ng` Item 17.12 as
   _"the sharpest A6 material in the storage corpus"_ at _"a boundary A6 has not yet looked at"_.
   `[A8 §5]` row 9's evidence column **opens** with Item 17.12.c and cites four of the five sources
   A5 names, including the NTS §1.6.10 sentence `[A8 §7.3]` quotes verbatim as **A8-JOINT**. Row 9 is
   described there as _"the best-sourced row in the document."_
2. **The resumption plan's source list omits the only grade-A source.** It names `src:dtr-part-iv`
   (grade **B**, every form figure an unread image) as A6's best and does not name
   `src:dp3-tender-of-service`, which scores the same or better on every A6 criterion, is one higher
   on C5, calls A6 its own _"second-strongest area"_, and is **grade A, read cover to cover**. It
   also omits `src:samsara` (the strongest mechanism source), `src:smartmoving-api` (the only
   HHG-native document types, and two orthogonal typing axes) and `src:dcsa` (§3.4's central
   temptation). §3.4's refusal and §3.5's decision both rest on sources the plan did not name.

**Audit what a plan says is owed before designing around it** now has three instances — [A4]'s blind
owed ledger, [A2]'s already-applied "seventeen-item backlog", and these two.

## The gate caught a count the reading got wrong

`[A6 §3.3]`'s first draft said `document` appears in five `context[]` columns. The new conformance
test **enumerates** the rows rather than counting them, and named **`weight.tare`** as the sixth. The
count is corrected in three files and the correction is recorded at the point of use, because it came
from the gate and not from the reading — which is `[A1 §9]`'s rule working in the direction it was
written for.

## What shipped

| What                  | Where                                                                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The area document     | `docs/domain-reference/analysis/A6-documents-evidence.md`                                                                                                                                                                                |
| **D-ID**              | `documentIdentitySubject` + `IDENTITY_SUBJECTS` + `DOCUMENT_KIND_IDENTITY_SUBJECTS` in `packages/domain-reference/src/rules/documents.ts`                                                                                                |
| **D-CITE**            | `CITATION_CLAIMS_NOTHING`, plus the rewritten `EvidenceRef` docstring in `src/assertions.ts` and the ratification in `src/rules/e-canon.ts`                                                                                              |
| The state refusal     | `DOCUMENT_STATE_IS_NOT_COMPUTABLE`                                                                                                                                                                                                       |
| The capture gap       | `CONDITION_BY_OMISSION_IS_NOT_EXPRESSIBLE`, held by `CaptureMethodsAreTheSeven` — **a gate, not a comment**                                                                                                                              |
| The whitelist mapping | `TABLE_A_402_4_LANDINGS` + `WHITELIST_RESIDUE_REASONS` + `whitelistResidue()`; `authority.ts`'s `Instrument.grants` TODO **taken**                                                                                                       |
| The absent class      | `documentIssuance` in `ABSENT_AND_OWED` + `[SD §4.7.3]` prose + the `AS_WRITTEN` entry                                                                                                                                                   |
| The deleted count     | `corrections.ts`'s _"exactly one amendment window"_, with §375.505(h) recorded beside it                                                                                                                                                 |
| Version               | **Unchanged at `0.5.0`**, with the non-bump at `[catalog §2.4]` and the absent count 14 → 15 at `[catalog §5]`                                                                                                                           |
| Registration          | `A6` in `DOCUMENTS`; two vocabularies in `VOCABULARIES`; `D-ID` and `D-CITE` in `RULES` — `tools/generate-glossary.ts`                                                                                                                   |
| Amended peers         | `[SD §4.7.3]` +1 and `[SD §4.6.2]` narrowed; `[A8 §9 item 8]` gains category **(e)**; `[A1 §6]` gains the rescission row; `[A4 §5]` gains the capture method and one column; `[A2]` and `[A5]`'s To-[A6] marked answered; `rubric.md` ×3 |
| Tests                 | New `tests/conformance/document-identity-and-evidence.test.ts` (22); scenario 7's `FINDING:` became the decision plus its consequence; scenario 4 gained D-CITE and D-ID                                                                 |

Gates green: `tsc` silent · vitest **369 passed** · lint clean · Alloy every command as expected ·
glossary and catalog regenerated and prettier fixed points · `npx prettier --check` clean over both
trees **except** `packages/domain-reference/alloy/run.mjs`, which fails on `main` already (verified
against `git show main:`, not assumed).

**The emitted schema diff is empty.** `git diff` over `captured.schema.json` and
`queried.schema.json` shows nothing; the only published change is `absentFactClasses` 14 → 15 in
`index.json`.

## Gates tampered and watched to fail

Eight, restored after each. `[A6 §9]` carries them in full; four are worth repeating here.

1. **An eighth `CAPTURE_METHODS` member** → `TS2322: Type 'true' is not assignable to type 'never'`.
   The only compile-time gate in the round, and without the tamper there would be no evidence the
   exactness assertion is not another tautology.
2. **`documentIssuance` renamed in `[SD §4.7.3]`** → `documents.test.ts` fires — but **only when both
   of its two mentions in that section are renamed.** The gate is a substring search over the
   section, not over the bullet. A gate that passes a half-tamper is still a gate; a reader who
   assumed it checked the bullet would be wrong, and that is worth knowing before relying on it.
3. **`document` removed from `weight.tare`'s `context[]`** → the six-row enumeration fails by name.
   This is the assertion that corrected §3.3's own first draft, so its tamper is the round's clearest
   case of a gate being worth more than a reading.

4. **`EvidenceRef` widened with an `inboundMessage` branch** → `document-evidence-refuses.ts` reports
   **both** `@ts-expect-error` directives unused, twice over. **This gate did not exist in the first
   draft**, and that is the round's sharpest self-inflicted finding — see below.

The other four: a `document`-only subject family added; `[catalog §5]`'s count reverted to 14; a
whitelist row naming a non-member `AssertionType` (`tsc`); and the Code-of-Service row's reason
changed from `VOCABULARY_REFUSED` to `AGGREGATE_OWED`, which collapses the residue to three kinds and
breaks the argument §3.6 rests on rather than the data.

## The round committed its own named defect, and the fix is the rule

**A6's first draft did not hold its central refusal.** Two tests were written for §3.5(c) — one
asserting `expect(['document','assertion']).not.toContain('inboundMessage')` over a hand-written array
that reads `EvidenceRef` not at all, and one asserting `expect(fixture.evidence).toBeUndefined()` over
a fixture the test itself wrote. **Neither could fail.** That is `[A2 §9]`'s tautology in a second
costume, committed inside the round whose §9 states the rule against it.

Fixed by applying the rule: widening `EvidenceRef` is an edge the types can see, so the gate is a
`-refuses.ts` file with two `@ts-expect-error` directives, tampered and watched. One runtime assertion
was deleted; the other rewritten to check what it honestly can.

A smaller finding came out of building it: **`@ts-expect-error` covers one line, and an inline
`EvidenceRef` literal with the wrong `kind` reports on its `ref` property**, so a directive above the
literal sits above the wrong line. Name the value first and annotate the **assignment**.

> **A refusal is not held by an assertion that the refused thing is absent from a list you wrote.**
> It is held by asking the compiler to refuse it. `[A6 §9]` carries this beside §9's other two
> constants, because the three together are the whole of the rule.

## [SD] was edited, not merely cited

`[SD]` outranks every area document, so a narrowing that lived only in A6 would be a **disagreement
with binding text** rather than a refinement of it — which is `[A2 §3.2]`'s precedent, where closing
`[SD §10.4]` bullet 1 meant editing `[SD §10.4]`. Three passages were therefore amended in `[SD]`
itself, beyond the `[SD §4.7.3]` entry:

- **§1.2's `document` bullet** opened _"A6 is not written, but…"_ — stale the moment this document
  landed. Replaced with a pointer to §3.2 and §3.3.
- **§4.6.2's E-CANON-RESOLVE** says the inbound message _"goes in `evidence[]`"_. A bracketed note now
  records that this is true on the **boundary** side, why the published union is not widened, and that
  E-CANON-OBLIGATION immediately below is where the link lives.
- **§4.6.3's _"same `evidence[]`"_**, where the narrowing **strengthens** the claim: both the admitted
  and the refused path produce the same published `evidence[]` and neither carries the message, so
  that paragraph's "one behaviour with a cardinality gate" is now held in the types.

## A recorded gap should be a gate wherever the gap has an edge — the next case along from [A2 §9]

`[A5 §9]`: a bare `Exact<>` alias is a comment until something is assigned to it. `[A2 §9]`: an
assigned one can still be a **tautology**, because `Exact<keyof typeof T, K>` over a mapped type can
never fail — _"an `Exact` earns its place only between two things declared **independently**."_

A6 is the positive case those two imply. `CONDITION_BY_OMISSION_IS_NOT_EXPRESSIBLE`'s claim — that no
capture method can express it — **has an edge the type system can see**: it is false the moment
`CAPTURE_METHODS` gains a member. So the seven names are re-declared in A6's own module, from A6's own
reading, with nothing generating either side from the other, and the tamper proves it fires.

Compare `DOCUMENT_STATE_IS_NOT_COMPUTABLE` and A2's `SHIPMENT_BOUNDARY_STAGE_IS_NOT_COMPUTABLE`, both
plain `= true` — correctly, because their claims are false only when a fact class is minted, and a
mint already touches three files and a test table.

> **The generalisation:** the rule is not "always gate a recorded gap". It is **gate it when the gap
> has an edge the types can see, and say why when it does not** — and A6 ships both halves side by
> side so the next reader meets the distinction rather than the pattern.

## One observation handed on rather than resolved

`src:dtr-part-iv` A-406 §B.4.b makes a partial withdrawal from NTS **split the lot** and force a new
warehouse receipt for the remainder, and §B.2.d makes the receipt _"a nonnegotiable document of title
whose original must exist exactly once."_ There, **the document determines the aggregate's identity**
— the direct opposite of `[A2 §3.2]`'s B-ONWARD. `[A5 §3.4(c)]` excludes NTS from the model, so it is
out of scope rather than refuted. Recorded at `[A6 §7]`'s fourth "assertion no source supports" and
in §Cross-area, so that whoever reopens permanent storage meets it rather than rediscovering it.
