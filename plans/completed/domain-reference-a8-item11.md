# `[A8 §9 item 11]` — the standing columns take holder KINDS: record

**Branch:** `feat/dr-a8-item11` off `44b28b54`. **Catalog `0.7.0`, not re-cut** — the emitted diff is
empty. **Written 2026-10-10.**

---

## 1. What landed

The three standing columns of `[A8 §5]`'s authority table — `corroborating`, `competing`, `advisory`
— took `readonly RoleName[]` while `authoritative` took holder **kinds**. A standing that names a
party by its **relation to the fact** therefore had nowhere to go, and was written into the row's
`note` as prose instead. That asymmetry was item 11.

| what                                                                                   | where                               |
| -------------------------------------------------------------------------------------- | ----------------------------------- |
| `StandingHolder = AuthoritativeHolder \| { kind: 'schemeCounterparty' }`               | `src/rules/authority.ts`            |
| the three columns retyped to `readonly StandingHolder[]`                               | `AuthorityRuleCommon`               |
| 48 cells converted; 42 through a new `standingRoles(...)` constructor, 6 already empty | `AUTHORITY_TABLE`                   |
| row 10 `identity`.corroborating ← `schemeCounterparty`                                 | was absent, prose in `note`         |
| row 17 `documentIssuance`.corroborating ← `schemeCounterparty`                         | was absent, prose in a `//` comment |
| row 11 `charge`.competing ← `performingRole`                                           | was `[]`, prose in `note`           |
| 4 `owedTo` strings rewritten to the `"Not owed — …"` convention                        | `data/authority-table.json`         |
| 3 type-level gates + 11 behavioural assertions + 7 `@ts-expect-error` refusals         | see §5                              |

**Seven gates green** (`test`, `lint`, `typecheck`, `alloy`, `glossary`, `catalog`, `context-map`).

---

## 2. Three things the resume plan got wrong, measured

The plan is `plans/in-progress/domain-reference-next-round.md` (removed by this round). It was a good
hand-off and its **"measure that before designing anything"** instruction is what produced all three
of these. Recording them because each changed the round's shape.

1. **"Two of the four already have a holder kind" → it is ONE.** `performingRole` exists, so the plan
   inferred that both of row 11's entries were already served. Measured: `charge`/`PROPOSED` is
   closed in the typed table (`authority.ts:800`, `{kind: 'performingRole'}`); `charge`/`competing`
   was `competing: []` with the standing stated in the row's `note`. One closed, three not.

2. **"Widening `TableStanding.roles` touches every row of the JSON and the loader" → the JSON side
   never moved.** The plan conflated the package's two representations of `[A8 §5]`. `src/data.ts`'s
   `TableStanding` is `{roles, unresolved, note}` and `AuthoritativeStanding extends TableStanding`
   — **already symmetric**, with every non-role holder in every column carried as an `unresolved`
   designation. The asymmetry was entirely in `src/rules/authority.ts`'s hand-written table. So
   `data.ts` is untouched, `data/authority-table.json`'s **shape** is untouched, and
   `vocabulary.test.ts` — which reads `standings.X.roles`, the JSON side — did not move either. The
   plan's "the type change and the gate have to move together" risk did not exist.

3. **"Whether the standings reach the wire has not been checked" → they do not, and that decided
   everything.** Counted in the emitted bytes: `corroborating`/`competing`/`advisory` have **zero**
   occurrences across all four `catalog/*` files and no `$def`. `AuthoritativeHolder` **is** emitted
   (`$defs/AuthoritativeHolder`, 9 members, both faces). So widening the columns is **type-only**,
   and the round is additive rather than the second breaking release in a row.

---

## 3. The finding: item 11 was minted at four entries and owned three

`charge`/`PROPOSED` **was never debt**, and not just since the typed table closed it. Its `owedTo`
said _"Not fixed — it is whichever role performed the act the charge is for, so it varies by
charge"_ **before** either of the last two rounds touched it — which is a "Not owed — computed"
statement in different words.

`[A8 §9 item 2]` re-pointed it here with the same boilerplate it gave the three genuine relations,
and **that boilerplate argues the wrong case for this one entry**: it says
_"corroborating/competing/advisory take `RoleName[]`"_, and `PROPOSED` is on the **authoritative**
column, which has taken holder kinds since `[A8 §4]`.

This is a live instance of the drift `authority.ts:562`'s own `TODO` predicts — _"Two representations
of one table is [SD §1.1]'s 'two homes for one fact' defect a level up: they can drift, and **nothing
checks that they have not**."_ Nothing does, and they had. **That TODO is deliberately NOT resolved
here** (it says "Not decided here" for a reason); this round fixed the one instance that was item
11's and left the reconciliation to its own round, with the instance written down as evidence it is
live.

---

## 4. The one new member, and why it is mintable

### It is ONE relation, not two

Rows 10 and 17 both bind `SCHEME`, both use `ISSUER_OF_SCHEME`, both are authoritatively
`schemeIssuer`. Row 17's `[A8 §5]` cell says it outright — _"which is row 10's echo one aggregate
over"_ — and `authority.ts:831`'s comment pointed at row 10's note for the same reason. Two
independent statements, neither of them this round's. **One member covers both.**

### Primary, captured, verified in the bytes — and the DIRECTION is the finding

`src:dcsa`'s `references` field,
`captured/DCSA-OpenAPI/domain/event/event_domain_v3.2.0.yaml:2082` (the same string in **nine**
further captured files):

> "**References** provided by the shipper or freight forwarder at the time of booking or at the time
> of providing shipping instruction. **Carriers share it back** when providing track and trace event
> updates, some are also printed on the B/L."

The provider issues the value; the party it was **provided to** shares it back. So the designation
picks out one determinate party from the scheme, exactly as `schemeIssuer` does from the other end —
which is why it is named `schemeCounterparty`, after the thing it reads, like every sibling kind.

**This matters because the alternative classification was live.** A standing defined as _whoever
agrees_ is `[A8 §4.1]`'s definition of corroborating, i.e. a **complement**, and `[A8 §9 item 2]`
turned two of those (_"the non-inspecting parties"_, _"everyone else"_) into notes needing nothing.
The echo is narrower: a third party that happened to assert the same value is not the counterparty.

### The grade check, because this round nearly refused it

| witness                                          | grade                                                                                      | supplies                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `src:dcsa` `references`                          | **primary, captured, verified ×10**                                                        | the obligation and its direction                                |
| `src:nmfta-ebol` `:1308`                         | **secondary** — `analysis.md` prose; registry has a sha256 but `local/` is not in the repo | the acceptance identifier distinct from the document identifier |
| `src:sirva-ade` `ExternalReference`              | secondary                                                                                  | performs the echo                                               |
| `src:weichert-supplier-api` `serviceOrderNumber` | secondary                                                                                  | the peer-reference pair                                         |

An intermediate reading of this round had both entries collapsing into complements on the grounds
that neither reads a field on its record — `record.identity` carries `{scheme, vocabularyScope}` and
no counterparty, `record.documentIssuance` has `secondSubject: false`, `Instrument` has no issuee.
**That test was the wrong one**, and finding out why is the round's second procedural lesson — §5.

**`[A8 §10]` carries the exposure as a row**, on the `visibilityProvider` precedent: the only primary
witness is one publisher in an adjacent domain. What limits it is that the member is **not emitted**,
so a consumer has nothing to unlearn if it is withdrawn.

### The resolution path is NOT in this model, and the docstring says so

`awardedRole` can name one (`subject = order:X` → that order's `orderAward`). This cannot: no record
of the exchange exists here, and reading it off `context[]` is forbidden by `[SD §1.4]` rule 1. It is
carried as a **designation** a consumer resolves from outside, and the docstring states that rather
than implying a path that does not exist.

---

## 5. Four procedural lessons

1. **A closure gate that greps the item's name fires on its own fix.** The first run of this round's
   own gate failed on all four rewritten entries, because a closed entry legitimately _cites_ the
   item that closed it. The gate has to read the **tense**: `cites item 11 AND NOT startsWith("Not
owed")`. In `GOTCHAS.md`.

2. **"Does the designation read a field on the record?" is the wrong resolver test here, because NO
   holder kind is resolved inside this package.** `heldHolderAt` has exactly one `kind` branch
   (`custodyHolder`, for the C5 gap); every other kind is returned verbatim as
   `{kind: 'holder', holder, rule}` and the consumer resolves it. The test the kinds actually meet is
   `keySideRole`'s own: **is the designation fixed by something determinate, or is it defined by the
   answer it is supposed to produce?** Determinate → a kind. Circular → a complement. Applying the
   field test instead would have refused a member with primary captured evidence behind it.

3. **Prose listing a type's members rots by being copied.** A four-name list described a nine-member
   union across six live sites, omitting two members (`schemeIssuer`, `performingRole`) that were
   load-bearing in the argument the list was being used to make. Deleted at `[A8 §2]`'s annotation,
   corrected at item 11, and replaced by `StandingHolderKindsAreExactlyThese`. In `GOTCHAS.md`.

4. **Every gate was tamper-run, and they are recorded here because a passing gate proves nothing.**
   Six behavioural tampers (revert `charge`.competing to `[]`; swap the echo for a role; smuggle a
   third non-role kind in; revert one `owedTo` to the owed tense; delete a designation instead of
   closing it; put a non-role string in a `{kind:'role'}` member) and four type-level tampers (narrow
   `StandingHolder`; promote the echo into `AuthoritativeHolder`; add a tenth kind; remove the echo
   member). **All ten go red, each on the intended gate** — and the promote-the-echo tamper also
   fires `TS2578` on `standing-holder-refuses.ts`, which is the designed second signal.

---

## 6. What this supersedes, and what it does not

Read §6 of the party, item-3 and item-2 records; **nothing in them is superseded**. Added:

- **`plans/completed/domain-reference-a8-item2.md` is left as written, and one claim in it is now
  known wrong.** Its §96 states `AuthoritativeHolder` as a union of four kinds. The convention in
  this series is that each record states what it supersedes rather than editing its predecessors, so
  the correction lives here and in the skeleton, not there. Its table at §82-84 should be read with
  §3 above: the `charge`/`PROPOSED` row was mis-pointed.
- **`[A8 §9 item 11]` is CLOSED.** Its three entries are listed in the typed table; the fourth was
  never its.
- **Still owed to `[A8 §9 item 2]`, unchanged and deliberately not swept into this round:** row 8's
  **NTS warehouseman** and row 11's **`RATED` tariff owner**. Both want role **names** and both are
  blocked on `secondary` grade. The tariff owner is refused a bare kind _by name_ in
  `standing-holder-refuses.ts`, because a missing name is `owedRole` carrying an `Owed<>` — that
  payload is the whole difference between it and `performingRole` one aspect over.
- **The `authority.ts:562` two-homes TODO is still open** and now has a documented instance (§3).

---

## 7. The measurement, for the next round

- **Wire: byte-identical.** All four `catalog/*` files diff clean against the pre-round build;
  `$defs/AuthoritativeHolder` still 9 members on both faces; `schemeCounterparty` has **0**
  occurrences in every emitted file. `0.7.0` stands, `[catalog §2.4]` gains no row.
- **`glossary.md`: byte-identical.**
- **`context-map.md`: changed** — `StandingHolder` crosses the hub threshold. **It crosses on REACH
  (3 areas), not spread (1 module)**, and **two of the three areas are methodological**: A1 and A2
  arrive through one site, `StandingHolderKindsAreExactlyThese`, whose docstring cites `[A1 §9]`
  ("enumerate, do not total") and `[A2 §9]` (the tautology bar). So this is **not** the cross-area
  edge `RoleClass`'s and `AssertedBy`'s promotions were. It is recorded as promoted anyway, with that
  said plainly in `context-map.test.ts`: deleting a true citation to drop a concept below a threshold
  is gaming the map rather than reading it. **If a later round tightens what counts as reach, this is
  the entry to re-examine first.**

## 8. The next round — unchanged from the resume plan's §1, minus this one

The three remaining candidates, as that plan costed them:

- **The party-to-party relation** — closes `[A8 §9 item 1]`'s hierarchy and maybe item 3's residue.
  **Ask first whether ONE fact class covers organisation→organisation and person→organisation; do
  not inherit an answer.** The person half may only be refusable.
- **`[A8 §9 item 4]` — delegation and on-behalf-of.** The only candidate whose best evidence is
  **primary** (§ 375.205's signed agreement + 24-month retention). Needs a second axis somewhere and
  has to argue with `[SD §1.1]`.
- **The government-office unfold** — `reinterpretedMember` over `accountParty`, **breaking**, on
  `secondary` evidence.

**One thing owed from outside this stream**, carried forward from the resume plan and still
unverified here: **#824** (`feat(pegii): write order statuses back — update_order + WriteOrder (SDK
0.49.0)`) landed between the two previous rounds. If nobody has published the SDK for it, the repo
rule is to tag `sdk-python-v0.49.0` after the bump merges.
