# Domain reference — A9, identity & cross-references: COMPLETE

**Landed 2026-09-29.** The deliverable of `plans/in-progress/domain-reference-areas-a9.md` — the
sixth of the unwritten area comparisons, after A1, A5, A2, A6 and A7, and **the last of the nine v1
detail areas.** The unwritten-area phase of this effort is over.

**The next round is a cleanup**, at `plans/in-progress/domain-reference-cleanup.md`. A9's own plan
had named the **context map** as the natural next deliverable; the user redirected it after reading
this round's summary — _"i want this done right… next up we are fixing any of the issues found
before proceeding"_ — so the defects the rounds found and left get paid down first, and the context
map moves behind them (that plan's §8 carries it forward unchanged). Four of that plan's items are
this round's own findings: the hardcoded `x-owed` sentence, the registry `areas:` field, the Owed
page's inability to say **why** something is owed, and the unfetched `src:nmfta-scac`.

## The headline

**A9 was the area expected to publish an owed vocabulary, and it refused — on the evidence, not for
want of work.** `identityScheme` is one of the three owed closed vocabularies and it is A9's;
[A4 §3] had already minted the change class (`publishedOwedVocabulary`) that publishing one uses.
A9 declines, because **five sources publish a closed identifier list and every one of them publishes
an open slot beside it, and two of the five publish a warning against their own hatch.** An enum
admitting only the schemes A9 can cite would be _less_ faithful to the corpus than the `OwedCode`
the model already ships.

What A9 publishes instead is a **witnessed-scheme table** (twenty schemes, thirteen sources) and one
rule over it — **I-ACCOUNT**, a partial function supplying the input [A6 §3.2(a)]'s **D-ID**
declared and could not fill.

The deliverable is `docs/domain-reference/analysis/A9-identity-cross-references.md` (≈800 lines),
one named rule, one twenty-row data table, two compile-time refusals, two load-time invariants, and
**no version bump** — the emitted schemas are byte-identical.

## The nine owed items, and how each closed

| #   | Owed by                                            | Settled                                                                                                                        |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `[A6 §Cross-area]`; `[A6 §3.2(a)]`; a live comment | **I-ACCOUNT** — a partial function, because the vocabulary its bit was to be a column of is refused                            |
| 2   | `[A1 §Cross-area]`                                 | **Not collapsed** — the acceptance survives as its own scheme, and its subject is an **act** the model lacks                   |
| 3   | `[A2 §Cross-area]`                                 | **Recorded, not modelled** — `CamisRegNumber`'s positions are evidence about the scheme, never a fact about the shipment       |
| 4   | `[A5 §Cross-area]`                                 | **Already expressible** — the `ltsRequestNumber` back-reference is an identity assertion; A5's refusal to link stands          |
| 5   | `[A3 §Cross-area]`'s A9 bullet                     | **Discharged before A9 opened**, by `[SD §7.4]`, which says so in as many words                                                |
| 6   | `round-1-crosscheck.md` §A9's "pick one shape"     | **Discharged by `[SD §7.1]`** — A9 supplies the terms and never the shape                                                      |
| 7   | `[A2 §3.6]`'s instruction to A6, A7 **and A9**     | **A split** — assign and reissue are expressible; the acts the model cannot record reduce to A6's and A8's, so nothing is mint |
| 8   | The rubric's A9 `Covers` row                       | **A prompt, not an inventory**, and the first instance where the residue runs **both** ways                                    |
| 9   | `identityScheme` on the Owed page                  | **Left owed, deliberately**, and the refusal is held by the compiler                                                           |

## The structural finding: the corpus's best-witnessed scheme has no subject

Five of the twenty schemes identify a **party** — `scac`, `usDotNumber`, `mcNumber`, `gbloc`,
`agentCode` — and `[SD §1.2]` has no party aggregate, so an assertion under any of them has no
`subject`. **`scac` carries six witness rows, more than any other row in the table, from four
publishing bodies** (the DoD twice, X12 twice, NMFTA, project44).

**A9 mints nothing for it, and that is the decision.** `[A7 §3.2]` is the precedent in shape — a
question that never reaches `[A8 §9 item 8]`'s ledger because the subject is missing — with one
difference that changes what to do: **A7's missing subject was nobody's; A9's is already owed by
name.** `[A8 §9 item 1]` owes the party entity and already lists _"DOT/MC number, SCAC
(`src:dtr-part-iv` #665), agent code"_ among its fields, and `ids.ts` already documents `PartyId` as
_"an identifier with no aggregate behind it"_. Recording it again would double-count one gap —
`[A7 §6]`'s warning one level out. A8's item gains a second, independent reason to be minted and A9's
§6 adds nothing to the ledger.

`partyRole` is the near miss and is the wrong answer: a SCAC belongs to the company whatever it is
doing on this shipment, so filing it against a role keys it on a tuple it does not vary with.

## The decisions worth remembering

- **A refusal argued from what the corpus publishes, not from what it omits.** Every prior refusal in
  this effort (`[A2 §3.3]`'s shipment type, `[A7 §3.3]`'s charge state) was argued from
  _disagreement_ — N publishers, no two alike. A9's is argued from **agreement**: the sources agree
  that the vocabulary should stay open, and two of them say why. That is a stronger refusal and a
  different shape, and it is worth having in the repertoire.
- **A partial function is the honest form of a discharged-but-not-closed hand-off.** I-ACCOUNT keeps
  **two** `undetermined` reasons apart — `SCHEME_NOT_WITNESSED` (the ordinary path, permanent) and
  `SCHEME_WITNESSED_BIT_NOT_PUBLISHED` (a finding, exactly one instance) — and then **collapses**
  them on the way into D-ID, because from D-ID's chair they are the same unanswered question. The
  one instance is `src:nmfta-ebol`'s acceptance identifier, whose subject is an **act**.
- **`[SD §7.1]`'s `issuer` / `authority` split gains a second witness in a regime with no equipment
  in it** — the PRO, drawn by the shipper from a carrier-issued block. It had been argued from `MS2`
  alone, which made it look like a property of equipment.
- **`[SD §7.5]`'s "canonicalise to match; never to store" turns out to be load-bearing for a failure
  mode it was not adopted for.** Three witnessed schemes are **constructed**; a canonicaliser that
  stripped leading zeros in storage would destroy a Julian day.
- **A capture proves a field exists and often defines nothing.** `src:milmove-mymove`'s
  `serviceOrderNumber` is in the captured swagger as a bare nullable string with no description. So
  `primary` is a statement about **provenance, not semantic strength** — the rubric's own
  "evidence grade caps confidence" rule read in the direction nobody reads it in.

## `areas:` in the registry is a prompt, not an inventory — and measuring first is what saved it

`src:dtr-part-iv` scores A9 `3/3/n-a/3/n-a/3/3/1` and its analysis opens the row with _"The
strongest area"_; its `areas:` list does not contain A9. So do `src:samsara` (_"Best-in-class"_),
`src:dp3-400ng`, `src:dp3-tender-of-service`, `src:cfr-49-375`, `src:shippeo` and others — fourteen
for A9 alone.

**The round's first instinct was to fix the fourteen entries. Measuring stopped it**: the same
mismatch exists for **every one of the thirteen areas**, A2 worse than A9. `areas:` was written
during the 2026-09-11 discovery passes, before any source was analysed. Repairing fourteen of a
hundred-odd pairs would have made the field look like an inventory precisely where it is not one.

So A9 makes **one** edit — a sentence in the registry's schema comment — and fixes no entry. The
size of the mismatch is deliberately **not** written into the document: `[A1 §9]` says a count in
prose is gated or deleted, and a gate over that one would fail the day somebody curates the
registry, which is the outcome the finding recommends.

> This is the **fourth** column in this corpus to be read as an inventory, after the rubric's
> `v1 detail` column, its `Covers` column (`[A6 §3.8]`) and A7's reading of the same.
> **A field written to decide where to look gets read as a record of what was found.**

## Gates tampered and watched to fail

**Nine tampers**, restored after each. The ones worth repeating:

1. **`SchemeName` narrowed to a two-member union** → `identity-schemes.ts: TS2322: Type 'true' is
not assignable to type 'never'`. Without it there is no evidence `IdentitySchemeStaysOwed` is not
   another of `[A2 §9]`'s tautologies. It is not: `SchemeName` is declared in `identity.ts` and the
   right-hand side is re-declared in A9's own module, and **the data table is deliberately not in the
   comparison**, because putting it there would assert the closure §3.2 declines.
2. **`'party'` added to `AGGREGATE_KINDS`** → `identity-scheme-refuses.ts` reports `TS2578`, which
   also proves the refuses file is in the typecheck.
3. **Four data tampers** — `scac`'s blocker removed, `[A8 §9 item 1]` written onto `tcn`,
   `documentAccountable: true` on `tcn`, a `scac` witness dropped → each throws or fails **by name**.
4. **The `C6` column index swapped for `C4`'s** → §2.1's margin assertion fails. Worth doing because
   that gate reads a **position** in a table it does not own — `[A6 §9]`'s half-tamper finding in a
   new place.

## The emitted schema diff IS empty, and it was checked rather than assumed

`SchemeName` keeps its `OwedCode` brand, so `SchemeName.identityScheme` stays a plain string with its
`x-brand`, `x-owed-vocabulary` and `x-owed` on both faces; nothing is minted; and
`data/identity-schemes.json` is a table no generator reads — `[A6 §3.2(d)]`'s finding holding a
second time. **No change class at `[catalog §2.3]` applies and `CATALOG_VERSION` stays 0.6.0.**

`[A7 §9]` is why this paragraph exists at all: A7's reasoning had started the same way and the diff
said otherwise, because `owedTo` is emitted as a `const`. A9's round touches an owed item's
neighbourhood twice, so the expectation was checked against the emitted `$defs` and not assumed. It
is empty because A9 changes no `owedTo` **string** and mints no branch.

## Four drafting defects, caught before the PR

A7 budgeted a deliberate read-the-diff-and-recount pass and it found three. A9 budgeted the same one
and it found four, **all of them claims nothing in the suite could contradict**:

1. **"the only area whose own subject was already on the model's owed list"** — false. `[A4]`'s
   subject was the reason vocabulary and it was owed until `[A4 §3]` published it. Rewritten as a
   **contrast**, which is a better opening than the superlative was: A4 could publish and did, A9
   cannot and says why.
2. **"the first time an area has left its own owed vocabulary owed"** — false. `[A8 §9 item 2]`
   leaves `roleClass` owed. Rewritten into the distinction that actually matters: **A8's vocabulary
   is owed because its sources are unread; A9's because its sources are read and disagree with
   closing it** — and the glossary's Owed page cannot tell those apart.
3. **"six party-grain rows"** — five, written into three files before the table was counted. Fixed
   and then **gated by enumerating the five by name**, which is `[A1 §9]`'s rule and the thing that
   stops it recurring.
4. **"the two DoD sources supplying ten of the twenty rows"** — three sources, nine rows. Both halves
   wrong, in one sentence, in the section about the evidence base's weakness.

> **Three of the four are `[A7 §9]`'s shape exactly** and the fourth is its cousin. The one claim
> that survived the pass because it had been **measured rather than asserted** is §2.1's `C6`
> density — A9 scores `C6 = 3` on 78% of its rows against 41% for the next area — and it is now
> gated as a **comparison** rather than a number, so it survives a source being re-scored.

## And a second pass found four more, which is the real lesson

Running the pass **again after the cross-area edits** found four more (`[A9 §9.4]`), including an
ordinal that had already been corrected once and was still wrong, and `[A3 §8]` used three times for
a bullet that is in A3's `Cross-area` section — the wrong citation being the one that looks right,
because the rest of the corpus does cite `[A3 §8]` for the nine acceptance scenarios.

**The rule is not "read it twice."** It is that the **cross-area pass adds prose after the review
pass**, so the review has to bracket it. All four were written or left standing in the last hour.
`[A7 §9]` established that the suite says nothing about prose; A9 adds that **the pass has to run
after the last prose is written**, and the last prose a round writes is always the part that edits
other people's documents.

## What shipped

| What                       | Where                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The area document          | `docs/domain-reference/analysis/A9-identity-cross-references.md`                                                                                                                                                                                                                                                                                      |
| The witnessed-scheme table | `data/identity-schemes.json` + `loadIdentitySchemes` in `src/data.ts`                                                                                                                                                                                                                                                                                 |
| **I-ACCOUNT**              | `schemeAccountability` (+ `schemeAccountabilityForDId`, `schemeBlocker`, `partyGrainSchemes`)                                                                                                                                                                                                                                                         |
| **The §3.2 refusal**       | `IdentitySchemeStaysOwed` + its assignment — **a gate**, tampered                                                                                                                                                                                                                                                                                     |
| The §3.5 refusal           | `CORRELATION_IS_AN_OBLIGATION_NOT_A_LINK` — a plain `= true`, with the docstring saying why                                                                                                                                                                                                                                                           |
| The type-level refusal     | `tests/conformance/identity-scheme-refuses.ts` — `party` is not an `AggregateKind`                                                                                                                                                                                                                                                                    |
| Version                    | **unchanged, 0.6.0** — the emitted schemas are byte-identical                                                                                                                                                                                                                                                                                         |
| Registration               | `A9` in `DOCUMENTS`; `I-ACCOUNT` and `IdentitySchemeStaysOwed` in `RULES`                                                                                                                                                                                                                                                                             |
| Amended peers              | `[SD §7.1]` ×2, `[SD §7.2]`, `[SD §7.5]`; `[A6 §3.2(a)]`; `[A8 §9 item 1]`; `rubric.md` — the status paragraph's opening list, its A9 clause and its closing sentence, a new `Covers`-row warning, a new note on the registry, and the live-plan link; `sources/registry.yaml` — the `areas:` schema comment. **Named rather than counted** ([A1 §9]) |
| Tests                      | `identity-schemes.test.ts` (24), `source-registry.test.ts` (6)                                                                                                                                                                                                                                                                                        |

Gates green: `tsc` silent · vitest **414 passed** · lint clean · Alloy every command as expected ·
glossary and catalog regenerated and prettier fixed points · `npx prettier --check` clean over both
trees **except** `packages/domain-reference/alloy/run.mjs`, which fails on `main` already — verified
with `git show main:` and `git diff main --stat`, which shows the file untouched by this round.

## What this closes, and what it does not

**Closes:** the unwritten-area phase. All nine `v1 detail` areas now have an area document, and the
rubric's note says so.

**Does not close:** `[A8]`'s ledger (fourteen owed authority rows), the three owed vocabularies —
**all three now with a reason on record**, since A9's is refused-on-evidence rather than pending —
`[SD §10.4]`'s two remaining bullets, and the three missing pieces of the old `model/` layer. The
context map is the cheapest of those and is the next plan.
