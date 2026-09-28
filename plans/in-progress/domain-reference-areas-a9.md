# Domain reference — the remaining unwritten areas: plan and resumption state

**Written 2026-09-28, after A7 landed**, to be read by a session with **no prior context**.
Everything needed to resume is here or is named by path. Read this whole file before starting.

It replaces `plans/in-progress/domain-reference-areas-a7.md`, which was **deleted** in the A7 PR,
not archived — that round's record is `plans/completed/domain-reference-a7-charges.md`. The
convention in this effort is that a finished round leaves a **record** in `plans/completed/` and its
**plan** is rewritten as the next round's, so do not go looking for an archived copy of a superseded
plan.

**Seven deliverables have landed.** Read their records first; each is short and each carries findings
worth not rediscovering:

- `plans/completed/domain-reference-a4-reasons.md` — the reason vocabulary.
- `plans/completed/domain-reference-a8-authority-rows.md` — A8 §5 rows 12-16. Its count of twelve
  corpus-blocked rows is the count **as at that round**; A1, A2, A6 and A7 have all moved it since.
- `plans/completed/domain-reference-a1-order-lifecycle.md` — the `boundBy` gap, and the rule that a
  count in prose is gated or deleted.
- `plans/completed/domain-reference-a5-storage-in-transit.md` — the physical-vs-administrative
  discriminator on authority rows, which A6 then found does not generalise.
- `plans/completed/domain-reference-a2-shipment.md` — the `Exact<>`-is-a-tautology finding. **Read
  it knowing A7 overturned its billable-weight placement** on binding text A2 did not check.
- `plans/completed/domain-reference-a6-documents.md` — three shipped defects, all of one shape.
- `plans/completed/domain-reference-a7-charges.md` — **the most recent, and the one whose _version
  story_ matters most to A9.** Its decisions changed no published byte and its **audit** moved the
  version anyway, because `owedTo` is emitted as a schema `const`. It also caught three of its own
  drafting defects before the PR, which is the first round to do that.

**Next deliverable:** **A9** (identity & cross-references) — the **last** of the nine v1 areas with
no analysis at all. §6 says what makes it different from every area written so far.

---

## 1. Where this stands, in one paragraph

A reference domain model of household-goods moving & storage exists, built from external sources
only. Three layers are live: a **research corpus** (`docs/domain-reference/sources/`, 87 sources, 32
analysed), a **binding decision layer** (`docs/domain-reference/analysis/`), and an **executable
specification** (`packages/domain-reference/`) whose glossary and published event catalog are both
generated from the code and gated against drift. The catalog is at `specVersion` **0.6.0**, carries
**two projections** (`custodyAt`, `orderStageAt`) and **four named rules that are neither**
(`shipmentContinuity`, A6's `documentIdentitySubject` and `CITATION_CLAIMS_NOTHING`, and A7's
`A-COLLECT`). What keeps it pre-1.0 is the fourteen remaining authority rows — and **A9 is the last
v1 area with nothing written**, so after it the unwritten-area phase of this effort is over and what
remains is A8's ledger, the three owed vocabularies, and the old `model/` layer (§5).

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
| A6, documents & evidence               | `analysis/A6-documents-evidence.md` + `src/rules/documents.ts`           | `a614b016`, PR #725 |
| ↳ A6 follow-ups                        | `rubric.md` paragraph repair                                             | `a3b84942`, PR #727 |
| A7, charges & billing hooks            | `analysis/A7-charges-billing.md` + `src/rules/charges.ts`                | _this round_        |

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
- **Four rules that are neither** — `shipmentContinuity` / **B-ONWARD** (`[A2 §3.2]`), A6's **D-ID**
  and **D-CITE**, and A7's **A-COLLECT** (`[A7 §3.7]`). All four take a discriminant as an input or
  are a semantics decision, because nothing publishes one.
- **The shipment boundary across an interruption**, **the storage stay**, and **what a charge is and
  who may say it**, all closed.
- **What `evidence[]` means** — a pointer, never a claim (`[A6 §3.5]`).
- **The cross-cutting mechanics**: `(outcome, reason)` factorisation, the Portion, correction
  semantics, the identity key, the capture rules M1–M7, and `[A8 §8]`'s `Instrument`.
- **Eight of thirteen areas written**: A1, A2, A3, A5, A6, A7, A8, and A4 (**vocabulary only** — its
  own scope note says so).

### What is NOT ready

1. **One of the nine detail areas has no analysis at all: A9.** `rubric.md`'s note is current.
   (A10–A13 are context-map-only **by design** — not gaps.)
2. **14 of 31 record types carry an owed authority row.** Still the single thing capping the catalog
   at pre-1.0 — see §5.
3. **Three owed code vocabularies**: `roleClass`, `unitOfMeasure`, `identityScheme`. **The third is
   A9's, and it is the first time an owed vocabulary has been the next area's own subject** — §6.
4. **F4 open** in `analysis/findings-from-alloy.md`; 18 declared owed values; **16** fact classes the
   corpus names that the vocabulary does not carry — the newest being `chargeCollection`, whose
   blocker is a missing **aggregate** (§5).
5. **`[SD §10.4]` is down to two open bullets** — the directional stop-type pairs (A3's) and custody
   authority's owner (A8's).
6. **A1's one open defect stands**: the requestor of a **completed** cancellation has no field.
   `[A1 §3.5]`, `[A1 §6]`.
7. **A6's defect stands**: no source publishes what a **signature asserts**. `[A6 §3.3(b)]`,
   `[A6 §6]` — owed to the **user** and to A10.
8. **A7 opened one of its own, and it is a silence rather than a conflict**: nothing says whether an
   `OffsettingRecord` may **cross subjects**, and `src:dp3-tender-of-service` NTS §5.8.2 publishes
   the cross-subject set-off. `[A7 §3.8]`, `[A7 §6]`.
9. **32 of 87 sources analysed**; 15 registry entries `needs-user`.

---

## 3. Rules that govern this work — binding, not preferences

1. **SCOPE.** An **IDEAL TARGET built from EXTERNAL sources only**. Our own systems are
   `role: mapping-only` in `sources/registry.yaml`. Never cite them for what the domain IS. Partner
   contracts (Weichert, SIRVA ADE, Atlas) ARE external evidence — **and A7 found the previous plan
   got that wrong about `src:sirva-ade`, so check `role:` in the registry rather than trusting a
   list** (§6 item 1).
2. **STANDALONE.** **No product integration.** No legacy lens, no invariants over real extracts, no
   migration sequencing, and **do not ask for native pegII orders**.
3. **DISCLOSURE.** Every claim cites a source that says **that** thing, or is marked **[ORIGINAL]** /
   **[SYNTHESIS]** inline at the point of use.
4. **OWED means owed.** A distinct value, never a null that reads as "nobody", never a guess — **and
   the owner is part of the value.** A7 found one owed to the wrong area entirely (§4 item 16).
5. **Code is normative for structure; documents are normative for rationale.**
6. **Precedence.** `00-shared-decisions.md` (**[SD]**) outranks everything. Then `[A8]`. Then the
   area documents `[A1]`, `[A2]`, `[A4]`, `[A5]`, `[A6]`, `[A7]`, `[A3]`, the forks. Then
   `[catalog]`.

---

## 4. Landing a change — the recipe A4, A8, A1, A5, A2, A6 and A7 established

Follow this order.

1. Add members to the `as const` array in `src/`, one JSDoc each **carrying a citation or a marker**
   — the disclosure gate reads the docstring, **including on the members of a two-member enum**. A
   JSDoc must not start with a bold marker, and **markdown emphasis must be `_x_`, never `*x*`**, or
   the glossary stops being a prettier fixed point.
2. Fill the per-member table in `data/` and extend the loader. **Cross-check the two as a set.**
3. Classify the change against `[catalog §2.3]` **before** picking the version — and note that the
   class you need may not exist yet (A5 added `publishedOwedShape`, A7 added `repointedOwedOwner`),
   **or that no class applies because nothing published changed** (A2 and A6).
4. Register new vocabularies in `VOCABULARIES`, new documents in `DOCUMENTS`, and any new **named
   rule or fold** in `RULES` — all three in `tools/generate-glossary.ts`. None is auto-discovered. A
   `RULES` entry may point at a **type** or a **constant**, not only a function.
5. Bump `CATALOG_VERSION` **only if the emitted schemas changed**, then `npm run glossary` **and**
   `npm run catalog`, then the tests.
6. **Tamper each new gate and watch it fail, then restore.**
7. `npx prettier --check` over `docs/domain-reference` and `packages/domain-reference` **before**
   committing. `packages/domain-reference/alloy/run.mjs` fails this on `main` already — verify that
   with `git show main:` and `git diff main --stat` rather than assuming it.
8. **Read the emitted schema diff before classifying the change**, and read it as evidence rather
   than as a formality. A2's was empty and A6's was empty and in A6's case the emptiness **was** the
   deliverable — **but A7's was not**, and the line that moved it was one no decision in the
   document put there (item 16).
9. **A data table may have more than two homes.** The authority table has three.
10. **A COUNT written in prose must be gated or deleted**, and **prefer a gate that _enumerates_ over
    one that counts**. **A7 is the strongest instance yet and it is a warning rather than a success**:
    its draft wrote "four independent publishers" where the table holds three sources — two of them
    the same programme — and "five of seven are DoD rules" where the answer is four. Nothing in the
    suite could contradict either, because neither was gated. **Count the table, then gate the
    count.**
11. **An `Exact<>` alias is not a gate until something is assigned to it** (A5) — **and an assigned
    one can still be a tautology** (A2). An `Exact` earns its place only between two things declared
    **independently**, and A6 and A7 both ship the positive case. A7's is worth reading for one
    detail: `data.ts`'s `QUALIFIER_VALUES` **`satisfies`** a type built from `QualifierByType`, and
    `satisfies` checks membership, **not exhaustiveness** — so the data table is not a second
    independent declaration and the re-declaration in A7's own module is.
12. **Gate a recorded gap when the gap has an edge the types can see, and say why when it does not.**
    A6 and A7 both ship both halves side by side.
13. **A refusal is not held by asserting the refused thing is absent from a list you wrote.** The
    house pattern is a `tests/conformance/*-refuses.ts` file whose `@ts-expect-error` directives go
    **unused** (`TS2578`) when the illegal state becomes legal. **Then tamper it.** And check the
    file is actually in the typecheck — `npx tsc --noEmit --listFiles | grep refuses` is the
    ten-second version, and a tamper that reports `TS2578` proves it anyway.
    **One mechanical trap inside it:** `@ts-expect-error` covers **one** line, so **name the value
    first and annotate the assignment**.
14. **If your decision narrows a sentence in `[SD]`, EDIT `[SD]`** — and the same courtesy applies to
    `[catalog]`, which A7 edited four times. **Before opening the PR, re-read your own
    §Cross-area list and check each item was actually written into the target document.** A7 found
    it had made four `[catalog]` edits with no `To [catalog]` section declaring them.
15. **When you insert into an existing paragraph, re-read the whole paragraph afterwards**, and
    **anchor a scripted replace on a whole paragraph rather than on a sentence inside one**. **Read
    the rendered diff of every prose file you touched** before opening the PR — `git diff -U8` is
    what A7 used, and it caught two overclaims that had survived three earlier passes.
16. **An owed item's OWNER is part of the value, and the owner is auditable.** A7 found `chargeValue`
    owed to **A11**, a claims area, when the value of a charge is not a claim — an error that had
    stood since the shared layer was written and that the gated **counts** could never have caught,
    because they count the inventory and do not read it. Two consequences:
    - The house shape of an `owedTo` is **`Owner — reason`**, and the owner names the area whose
      **subject** it is, not the area that will publish it next (`conditionValue`'s owner is
      `A4 / A10` and A10 is context-map-only).
    - **`owedTo` is emitted as a schema `const` on both faces**, so correcting one is a published
      change and costs a version bump. `repointedOwedOwner` at `[catalog §2.3]` is the class.

---

## 5. The authority rows — the ledger's shape, as A1, A5, A2, A6 and A7 left it

Read `[A7 §3.2]`, `[A6 §Cross-area]` to [A8] and `[A8 §9 item 8]` **(a)–(e)** together. Five areas
have now looked at the ledger and between them they have sorted it into **five** kinds of blocker.
**Do not write that ordinal into a document** — A7 had to correct exactly that phrasing in three
places, because the glossary, `[A8 §9 item 8]` and this file each count differently. Name the
blocker, not its position.

- **Blocked on nothing but minting** — `documentIssuance` (A6). `[A8 §5]` row 10's
  `boundBy = SCHEME` already determines its holder. Still the cheapest move in the model.
- **Blocked on a missing `boundBy` _enum member_ — a schema decision A8 can take today.**
  `orderResponse` and `orderCancellation` (A1), and `shipmentCommitment` (A2). All three want the
  same member: _the role resolved by the order's own award_. Four things wait on it.
- **Blocked on a missing _party entity_ — `[A8 §9 item 1]`.** `partyRole` (§9 items 1-2),
  `notification` (§9 item 6), and A5's three storage classes.
- **Blocked on a missing _subject_ — A7's, and it never reaches the ledger at all.**
  `chargeCollection`: `[SD §1.2]` has no `invoice` and no `payment` aggregate, so the authority
  question cannot be asked. The model's other instance is `placeRef`. **Note what A7 refused here**
  — `[SD §1.2]` is open to addition and `[catalog §2.3]` classes a new aggregate kind as additive,
  so this was the cheapest mint available and it was still declined, because minting `invoice` alone
  reproduces A6's `document` (a subject with no facts) and giving it facts needs a value that is
  itself owed.
- **Blocked on the corpus.** The nine plan-, membership- and assignment-side rows; `src:dcsa`'s JIT
  `classifierCode` is where to look first (A1). Plus `orderAward`.

### The two procedural lessons, which are A6's and A7's

A6's: **a round is not done when the suite is green.** It is done when every refusal is held by
something that can fail and every consequence claimed for another document has been written into it.

A7's, which is the same lesson one level out: **the suite says nothing about prose, and prose is
where the counts, the superlatives and the conventions live.** A7 budgeted a deliberate
read-the-diff-and-recount pass and it found three defects that had survived three earlier passes —
a wrong publisher count, three overclaimed superlatives, and an `owedTo` that broke the house shape
and would have rendered as _"owed to blocked on the corpus"_ in the glossary. **None of them could
have failed a test.** Budget that pass.

### Three pieces of the old `model/` layer are still missing

The context map, the command side, the aggregate lifecycles. The context map is the cheapest and
would help the remaining work. **After A9 there is no unwritten v1 area left**, so this is the
natural next candidate — see §8.

---

## 6. THE NEXT DELIVERABLE — A9

**A9 (identity & cross-references) is the last v1 area with no analysis, and it is the first whose
own subject is already on the model's owed list.** `identityScheme` is one of the three owed closed
vocabularies, it is **A9's**, and `[A6 §Cross-area]` to [A9] has already specified one bit each of
its members must carry. So unlike every area written so far, A9 does not have to argue that it owns
something — it has to decide whether it can **publish** it, and publishing an owed vocabulary is a
known, classified, version-moving act (`publishedOwedVocabulary`, `[catalog §2.3]`, first used by
A4).

1. **The scope trap is real but is the _narrow_ kind**, and it is the mirror of A7's. Our own
   systems publish identity models — `src:pegasus-cloud-prisma`'s `IntegrationCorrelation` is named
   repeatedly in the corpus analyses as "the right shape at the wrong arity" — and they are
   `mapping-only`. **Check `role:` in `sources/registry.yaml` per source rather than trusting any
   list, including this one**: A7's plan asserted six mapping-only sources and one of the six was an
   external partner contract A7 was entitled to cite (`plans/completed/domain-reference-a7-charges.md`,
   §1 finding 2). `grep -n 'role: mapping-only' sources/registry.yaml` with the `- id:` lines is the
   check, and it takes ten seconds.
2. **The inbound hand-offs — grep for them, do not trust this list.** A7 found the previous plan
   named four where there were eight, and **two of the four it missed were in code rather than in
   prose**. Run all of these:
   - `/usr/bin/grep -rn -a 'A9' packages/domain-reference/src packages/domain-reference/tests packages/domain-reference/data`
   - `/usr/bin/grep -n -a '\[A9\]\|To \[A9\]\|A9 ' docs/domain-reference/analysis/*.md docs/domain-reference/rubric.md`
   - the glossary's **Owed** section, and `[SD §10.4]`.
     What is already known to be waiting:
   - **`[A6 §Cross-area]` to [A9], and it is a requirement on every member of the owed vocabulary**:
     _"whether a scheme is **document-accountable** — assigned to the form, independently of any
     shipment"_ (`[A6 §3.2(a)]`). A6 owns the difference between a document's own fact and a fact it
     carries; **A9 owns the scheme list**, and when `identityScheme` is published each member needs
     that bit. The evidence is already gathered in that section — `src:dtr-part-iv` A-413 §C.2's
     accountable stock, `src:nmfta-ebol`'s acceptance identifier distinct from the document
     identifier, and `src:cfr-49-375` §375.519(a)(5)'s admission that a party can have no identifier
     at all.
   - **`[A1 §Cross-area]` to [A9]**: the **award** and the **acceptance** are separately dated in
     the corpus's one published protocol (`src:stedi-x12-reference`'s `B1-03`;
     `src:atlas-world-group-api`'s `quoteNumber` and `ord_fromorder` beside `ord_number`), _"which
     A9 should not collapse"_.
   - **`[SD §7]`'s `I-KEY`** is settled and is A9's floor, not its question: identifier arity and
     `primary` key on `(subject, scheme, vocabularyScope)`.
3. **Run A2's, A6's and A7's check: does A9's own central act have a record?** The three answers so
   far are all different — A2 found no act and a `boundBy` blocker, A6 found no act and an
   **answerable** authority, A7 found no act and a missing **subject**. A9's subject is `identity`,
   which **is** a declared type with a declared qualifier and an assigned authority row
   (`[A8 §5]` row 10, `boundBy = SCHEME`). **So A9 starts where A7 started and one step further on**,
   and the question to ask is the one A7 asked: what acts are performed _on_ an identifier —
   assigned, voided, superseded, re-issued — and does any of them have a record?
   `src:dtr-part-iv` A-413 §C.2's void/lost/stolen reporting and 180-day audits is where to look
   first, and note it is **already cited by A6**, so read `[A6 §3.3]` before claiming it.
4. **A9's best sources.** `round-1-crosscheck.md` §A9 calls the area **over-covered** — _"five
   sources independently converge on (issuer, kind, value) with a counterparty slot"_ — which is the
   opposite of every area since A4 and changes what the work is. Its own recommendation is to **pick
   one shape** rather than synthesise: `src:dcsa`'s three slots, or `src:project44`'s typed 70-value
   list. Beyond those: `src:alvys-api` scores `3/3/n-a/0/n-a/3/3/3` and its analysis calls it _"the
   best A9 in the comparator set"_ for `References[]` as a typed object carrying `Type`, `Access`
   (Internal/Public) and `Origin` (Manual/Integration) — **provenance and visibility travelling with
   the identifier**, plus the published correlation hazard _"key on `tenderId`, not on the shipment
   identifier"_. `src:milmove-mymove` scores `3/3/n-a/2/n-a/3/2/2` with **six identifier kinds each
   with a stated audience** and derived composite ids. `src:dp3-400ng` scores C6=3 for GBLOC's
   documented **reassignment between offices** with an effective date. `src:nmfta-ebol` and
   `src:sirva-ade` supply the acceptance-vs-document split and `ReferenceNbr`/`ReferenceType`.
   **Check the captures**: `atlas-world-group-api`, `cfr-49-375`, `dcsa`, `gs1-epcis-cbv`, `gtfs`,
   `milmove-docs`, `milmove-mymove` and `x12-212-trailer-manifest` have a `captured/` directory —
   confirm with `ls -d docs/domain-reference/sources/*/captured` rather than trusting this sentence,
   and mark primary vs secondary per source the way `[A6 §2]` and `[A7 §2]` do.
5. **Watch for this specific trap.** `[SD §7.1]`'s **I-KEY** is settled text and A9 must not
   re-derive it; what A9 adds is the **scheme list**, its per-member bits, and the correlation
   semantics between schemes. And `[A6 §3.2]`'s **D-ID** already decides which subject an identifier
   found on a document attaches to — A9 supplies D-ID's input and must not re-answer its question.

**Pattern to follow:** `analysis/A7-charges-billing.md` and `analysis/A6-documents-evidence.md` are
the two closest models. **A7's §1 is the one to copy for the opening** — it audits what is owed to
the area by name against the **code** and the **binding text**, and its first three findings are all
corrections to the plan it was working from. **Do that audit before trusting this file's §6.** A7's
§2 is the model for a source survey marking primary vs secondary per source; A2's §3.3 and A7's §3.4
are the models for a refusal argued from a facet analysis; A6's §3.6 and A7's §3.4(c) are the models
for a mapping whose **residue** is the finding.

Start §1 by grepping as item 2 says, and **read the existing tests** — A6 found a test titled
`FINDING:` waiting for it and A7 found a hand-off inside a **passing** assertion's comment. The
rubric — 13 areas, 8 criteria, evidence grades — is `docs/domain-reference/rubric.md`, which now
carries A6's and A7's warnings that the `Covers` column is a prompt rather than an inventory.

---

## 7. How to work here — hard-won, and worth keeping

### Verification discipline

- **Run the gates yourself. Never trust a report.**
- **Prove a gate bites by tampering.** A false green is worse than a red. A5 shipped a compile-time
  assertion that did nothing; A2 shipped one that could never fail even though it was assigned; A6's
  tamper of a documentation gate revealed it passes a **half-tamper**, because it is a substring
  search over a section rather than over the bullet it looks like it checks — **A7 re-tested that and
  reproduced it exactly**, which is worth doing rather than assuming, because a finding about a gate
  is only true of the gate as it stands.
- **Prefer a gate that enumerates over one that counts** — §4 item 10, and read A7's failure there.
- **Hold a refusal in the type system, not in a runtime assertion over a literal you wrote.** §4
  item 13.
- **Re-read your own §Cross-area list before opening the PR.** §4 item 14 — and check `[catalog]`,
  not only `[SD]`.
- **Read the rendered diff of every prose file you touched, and re-count every count.** §4 items 10
  and 15. **No gate in this package reads prose for sense**, and A7's three drafting defects were all
  prose.
- **Read the existing tests for the records you are writing about.** An `OWED` label, a test title,
  **or a comment inside a passing assertion** naming your own area is a to-do item.
- **Check whether the source captures exist before planning to quote primary text**, and note that
  **evidence grade is not the same as having a capture** — `dp3-tender-of-service` is grade **A**
  with no capture. `ls -d docs/domain-reference/sources/*/captured` is the check.
- **`grep` here is a ugrep wrapper with `-I`, and one NUL byte makes it skip a file silently.**
  `generate-glossary.ts` and `tests/conformance/documents.test.ts` both hold literal NULs. **When a
  negative grep result is load-bearing, use `/usr/bin/grep -a`.** Recorded in
  `dolas/agents/project/GOTCHAS.md`.
- **`vitest` does not typecheck.** Run `npm run typecheck` after every test edit.
- **The same trap has a `gh` shape.** `mergeQueueEntry` is not a valid `gh pr view --json` field.
- **Verify AFTER the pre-commit hook, not before.** It runs `eslint --fix` + `prettier --write`.

### Working with the generators

Both live in `packages/domain-reference/tools/` and read `src/` through the **TypeScript compiler
API**. If you extend either:

- **Prettier must run inside the generator.** `JSON.stringify(x, null, 2)` is not a fixed point.
- **`anyOf`, never `oneOf`** when rendering a TypeScript union.
- **`aliasSymbol` is lost when a distributive conditional is instantiated.**
- **`checker.getUnionType` is internal API** — it runs and does not typecheck.
- **A JSDoc must not start with a bold marker**, every member of every registered vocabulary needs
  one, and **emphasis must be `_x_`, never `*x*`**.
- A new analysis document is gated automatically: `tests/conformance/documents.test.ts` scans every
  `.md` in `analysis/`, so any `` `type = X` `` span must name a real vocabulary member. To make a
  `[yourdoc §x]` citation link, add it to `DOCUMENTS`. Adding an absent class is a **two-file**
  change plus a test-table entry.
- **The published schema is not the same as the data table** — A6's D-ID cost no bump because the
  narrower `context` list in `data/canonical-subjects.json` is documentation, not a published
  constraint. **But the reverse also happens**: A7 found `owedTo` emitted as a `const` on both
  faces, so a string that looks like documentation moved the version. **Check the emitted schema
  both ways.**

### Workflows and CI

- **Parallel authoring causes drift.** Settle a shared layer FIRST, then fan out.
- **CI runners are slower than this machine.** `testTimeout` covers test **bodies** only —
  `beforeAll` needs `hookTimeout`.
- **Betterleaks scans full history**, so removing a file in a later commit does not help — amend.
- **Dependency Review** reads any `package.json` in the diff, including inside captured material.
- **`new-worktree.sh` rewrites `apps/e2e/.env.test`** with the worktree's Postgres port. It is
  tracked, so `git checkout -- apps/e2e/.env.test` before committing.
- **Extractors:** `pdf2txt.py` / `odt2txt.py` are **gone**. A captured XML can be read with a small
  `re`-based tag-stripper.
- **Worktree slugs collide on the derived Postgres port** —
  `python3 -c "s='<slug>'; print(5433 + sum(ord(c) for c in s) % 60)"`, and check it is free with
  `ss -ltn` before choosing a slug.

---

## 8. Housekeeping left over

- **After A9, the unwritten-area phase is over.** What remains is `[A8]`'s ledger (§5), the three
  owed vocabularies, `[SD §10.4]`'s two bullets, and the three missing pieces of the old `model/`
  layer. The **context map** is the cheapest of those and is the natural next plan.
- **Separate repo, unrelated to this plan** — `~/repos/pegasus-workflows`,
  `platform/integrations/weichert/rules.json`: six rules carry `sourceRef: "Weichert API: …"` quoting
  sentences that appear nowhere in `weichert-api.odt`. Confirmed by the user: they came from
  **observed API error responses**. Reword them, and fix the packed-but-not-loaded dead end —
  `pre-in-progress-forbids-pack-actual` combined with Weichert's real load-actual requirement leaves
  no valid status for a shipment packed but not yet loaded. Live in GLOBAL and the `nw` tenant.

---

## 9. Starting the next session

```bash
cd ~/repos/pegasus && git fetch && git pull --ff-only    # primary checkout, parked on main
python3 -c "s='a9-identity'; print(5433 + sum(ord(c) for c in s) % 60)"   # check that port is free
ss -ltn | grep -E ':(54[3-9][0-9])'                                        # …against what is listening
scripts/workstream-start.sh feat a9-identity plans/in-progress/domain-reference-areas-a9.md
```

Then work in the new worktree; commits land with the implementation as **one PR**, and the plan is
archived to `plans/completed/<slug>.md` **before** opening it.

> **Two things about `workstream-start.sh`.** It **copies** the plan to
> `plans/in-progress/<slug>.md` inside the worktree, so the worktree ends up with **two** copies —
> the seeded one and this file. Do not edit both. The pattern that worked five times: write the new
> record at `plans/completed/domain-reference-a9-<slug>.md`, write the **next** round's plan as a new
> `plans/in-progress/domain-reference-<next>.md`, then delete the seeded copy and remove this file
> — **and update `rubric.md`'s link to this plan**, which is the one cross-reference to it outside
> `plans/`. And the script provisions Postgres **after** creating the worktree and branch, so a port
> collision fails late and leaves partial state — `scripts/rm-worktree.sh <slug>` cleans it up.

**Read before writing anything:**

1. `plans/completed/domain-reference-a7-charges.md` — the most recent, and the source of §4 items
   **10, 14, 15 and 16**, §5's fifth blocker kind and its warning about ordinals, and the discipline
   of auditing the plan itself. **Its "three drafting defects" section is the one to read twice**:
   all three were claims nothing in the suite could contradict, which is A6's shape caught one step
   earlier.
2. `docs/domain-reference/analysis/A7-charges-billing.md` — §1 for the audit, §2 for a
   primary-vs-secondary source survey, §3.4 for a facet refusal whose **residue** is the finding, and
   **§9 for why one refusal is a gate and its neighbour is not**.
3. `docs/domain-reference/analysis/A6-documents-evidence.md` — §3.2's **D-ID**, whose owed input is
   A9's first deliverable, and §Cross-area to [A9], which specifies it.
4. `docs/domain-reference/glossary.md`, the **Owed** section — the honest state, always current.
   `identityScheme` is there, and it is A9's.
5. `docs/domain-reference/analysis/00-shared-decisions.md` **§7** (the identifier, `I-KEY`, and the
   vocabulary scope — A9's floor and not its question), §4.7.3 (the absent classes) and §10.4.
6. `docs/domain-reference/analysis/published-event-catalog.md` §2.3 — **now with three owed classes,
   the newest being A7's `repointedOwedOwner`** — §2.4's bump table, and §5.
7. `docs/domain-reference/analysis/round-1-crosscheck.md` §A9, which calls the area **over-covered**
   and recommends picking one published shape rather than synthesising one.
