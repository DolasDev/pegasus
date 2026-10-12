# `[A10]` — the contracting carrier, and `survey` / `estimate`: plan

**Branch:** `feat/dr-carrier-role-survey-estimate` off `b072ddab` (= `origin/main`, PR #833's merge).
**Worktree:** `/home/steve/repos/pegasus-deps-advisory-flip`. Postgres not needed.
**Started 2026-10-12.** Written to be read by a session with **no memory of it**.

**Baseline saved:** the six emitted files are copied to this session's scratchpad
(`baseline/{catalog/,glossary.md,context-map.md,symptom-index.md}`) **before** `vocabulary.ts` was
touched, so the emitted diff can be classified from bytes rather than from intention.

This is plan `[A8 §9 item 4]`'s **§8.3(3)**, and the **first of these rounds to emit a real catalog
diff** — §8.3(1) (the symptom index) and §8.3(2) (retention) both left the catalog byte-identical.

---

## 0. The round changed shape before it started, and the user chose the larger version

§8.3(3) said "write `survey`, `estimate` and `claim`". Measured, **all three are asserted by the
same party — "you, the motor carrier" — and `ROLE_NAMES` has no carrier-side member.** That is
`[A8 §9 item 2]`'s blocker, `refusedOnEvidence`, and it is the same one holding `stayAuthorisation`,
`stayTermination` and `charge`'s `RATED` aspect.

`documentIssuance` escaped it only because **the bill of lading has a number scheme of its own**, so
`boundBy = SCHEME` named its issuer without needing a role ([A8 §5] row 17: _"Row 10's rule, not a
new one, and that is the whole argument for the row existing"_). A physical survey has no scheme and
no instrument; a **binding** estimate is made "an integral part of the bill of lading contract"
(§375.403(a)(3)) but a non-binding one is not. So the escape route does not generalise.

**Presented to the user as three options** — partial close on primary evidence, refuse all three with
written blockers, or fix the root cause by naming the carrier-side asserter. **The user chose to fix
the root cause** (2026-10-12), and then chose to mint **role + `survey` + `estimate`** in one round
with `claim` refused.

**One correction to the question as it was put.** The option was offered as "likely BREAKING". It is
**additive**: a new member of a closed enum the catalog publishes is `newClosedEnumMember`
([catalog §2.3]), which is how `visibilityProvider` shipped at `0.7.0`. `0.7.0` was breaking because
it **renamed** `customer` → `goodsOwner`, and renaming is the thing to avoid later — which is why
the name was put to the user rather than chosen here.

---

## 1. The evidence for the role, counted rather than asserted

`src:cfr-49-375`, **primary captured**, `sources/cfr-49-375/captured/cfr-49-375.xml`.

| candidate term                      | total | carrying a duty | note                                   |
| ----------------------------------- | ----: | --------------: | -------------------------------------- |
| **`Household goods motor carrier`** |     8 |               3 | **the §375.103 DEFINED term**          |
| `motor carrier`                     |    35 |              10 | not defined here                       |
| `carrier`                           |    52 |              18 | not defined here                       |
| `mover`                             |   225 |             116 | **see the trap below**                 |
| `moving company`                    |     2 |               0 | no duty anywhere                       |
| `van line`                          | **0** |               0 | absent from the part entirely          |
| `individual shipper`                |   175 |             131 | the counterparty, already `goodsOwner` |

> **The trap, and it is item 2's trap exactly.** `mover`'s 225 looks like the best-evidenced name in
> the part. **222 of those 225 are in Appendix A** — the consumer booklet _"Your Rights and
> Responsibilities When You Move"_ — against **3** in the regulatory text. The defined term runs the
> other way: **5 regulatory, 3 Appendix A.** A raw count would have picked the
> consumer-facing word, which is how `[A8 §9 item 2]` first picked `customer` over
> `individual shipper` and had to be reversed. Counts are in `scratchpad/count_carrier_terms.py`;
> the regulatory/Appendix-A split is in `read_defs.py`.

**The strongest argument in the round is the definition's content, not its count.** §375.103:

> _"**Household goods motor carrier** means — (1) In general, a motor carrier that, in the ordinary
> course of its business of providing transportation of household goods, offers some or all of the
> following additional services: **(i) Binding and nonbinding estimates; (ii) Inventorying;
> (iii) Protective packing and unpacking** of individual items at personal residences;
> **(iv) Loading and unloading** at personal residences."_

**The regulation defines this party BY the fact classes this round is minting.** Estimates and
inventorying are two of the four services that constitute the definition; `packing`, `loading` and
`unloading` are already in the vocabulary and already have [A8 §5] rows. So the role is not an
inference from the duties — the duties **are** the definition.

### 1.1 The name: `contractingCarrier`, and why not the defined term

**Chosen by the user 2026-10-12** from two candidates, on **A8-NAME-1** and on `goodsOwner`'s
precedent: item 2 picked `goodsOwner` **over** the §375.103 defined term `individual shipper`
because _"the word that matches the axis is the owner's"_ — name the axis the role occupies, do not
quote the source.

The axis here is **contract against performance**. `hauler` is _"the party performing the
linehaul"_; `r19Agent` is an _"authorised substitute performer"_; `originAgent`/`loadAgent`/`packer`
perform at a place. The missing member is the party **in contract with the shipper** — whose bill of
lading it is, who owes the estimate and survey duties, and who remains liable when it delegates
performance. `householdGoodsCarrier` was the alternative and names the industry rather than the
axis — and it fails to distinguish the role from `hauler`, which is **also** a household-goods
carrier.

**Ruled out here rather than offered:** `principalCarrier`. `PRINCIPAL` is already a `boundBy`
member meaning _"the party the arrangement is for"_, and a role spelled with the same word would
collide in prose with the binding that §2 below gives these very rows.

---

## 2. `boundBy = PRINCIPAL` for both rows, and it is sourced

Neither row can use `SCHEME` (no scheme), `CUSTODY` (no custody boundary — a survey happens before
the goods move), `ASSIGNMENT`, `KEY`, `AWARD` or `NONE`. The candidate was a **new** `boundBy`
member, and it is not needed:

> `PRINCIPAL` — _"belongs to the party the arrangement is **for**; moves only when the principal
> changes"_.

Read against §375.205(a)(1) — **primary captured, and already measured by `[A8 §9 item 4]`'s M1** —
that is exactly this binding:

> _"A **prime agent** provides a transportation service **for you or on your behalf**, including the
> selling of, or arranging for, a transportation service. You permit or require the agent to provide
> services **under the terms of an agreement or arrangement with you**."_

"You" is the motor carrier (Subpart B is _"Before Offering Services to My Customers"_). So when an
origin agent conducts the survey, **the arrangement is for the carrier**, and authority does not
move to the performer. §375.409 is the same shape from the other side: a household goods broker may
produce the estimate _"provided there is a written agreement between the broker and you, the motor
carrier, **adopting the broker's estimate as your own estimate**"_ — the broker authors, the carrier
owns.

**This is the answer to the question `[A8 §9 item 4]`'s M3 left open as "a third delegation shape".**
An attribution transfer does not need a new binding: `PRINCIPAL` already means the authority stays
with the principal. Item 4's delegation round is still paused and this does **not** resume it — what
is settled here is only the binding for these two rows.

---

## 3. `survey` — an act, and the cheapest of the three

- **Family:** `goods` (= `{shipment, portion}`). The survey is of _"the household goods to be
  transported"_.
- **Act, so no `ValueByType` entry** — `ValueByType` is "the `value` shape of every **non-act** fact
  class" and is gated by `Exact<keyof ValueByType, NonActType>`.
- **§375.103 DEFINES `Physical survey`**, which is a second defined term this round leans on:
  _"a survey which is conducted on-site or virtually. If the survey is performed virtually, **the
  household goods motor carrier must be able to view** the household goods through live or
  pre-recorded video that allows it to clearly identify the household goods to be transported."_
  The definition puts the duty on the carrier **by name**, which is the asserter this round mints.
- **§375.401(a)** is the duty: _"You **must** conduct a physical survey… and provide the prospective
  individual shipper with a written estimate, **based on the physical survey**"_ — so the survey is
  also the estimate's own input, which is why the two mint together.
- **Authority row:** `{kind: 'role', role: 'contractingCarrier'}`, `boundBy: 'PRINCIPAL'`.

**Its waiver is recorded and is NOT modelled as a fact class.** §375.401(a)(1)-(3): the shipper may
waive the survey, in writing, **signed before the shipment is loaded**, retained as a bill-of-lading
addendum under §375.505(d)'s retention. That is a signature and a filing rule — and the model has
already decided twice that a **signature is not a fact class** (`documentIssuance`: _"no source
publishes what a signature asserts… a fact class needs a value"_) and that a retention period
_"belongs in `evidence[]` / obligation territory"_ (item 4's M1). So the waiver is **named in the
docstring and minted as nothing**, which is the same call `documentIssuance` made.

---

## 4. `estimate` — a non-act, with ONE key and an owed value

### 4.1 It is not `charge` at `aspect = PROPOSED`, and the reason must be written down

Both are pre-performance money facts, so a later reader will try to collapse them. Two reasons they
are different, and either alone is sufficient:

1. **Row 11's `PROPOSED` authority is `performingRole`** — _"whichever role performed the service
   being charged"_ — which **presupposes performance**. §375.401 has the estimate produced _before_
   the bill of lading exists and before anything is performed.
2. **The grain differs.** `charge`'s family is `charge` (one charge); an estimate is _"the **total**
   cost"_ for the shipment (§375.401(b)(1)-(2)). A shipment total is not a value of a per-charge
   fact.

### 4.2 Binding vs non-binding is NOT a fact-key qualifier — one key, successive assertions

The tempting design is `charge`'s: a `{binding}` qualifier with a per-aspect authority. **The corpus
refuses it.** §375.403(a)(7):

> _"Once you load a shipment, **failure to execute a new binding estimate or a non-binding
> estimate** signifies you have **reaffirmed the original binding estimate**. You may not collect
> more than the amount of the original binding estimate…"_

A new estimate **of either kind** replaces the original, and silence reaffirms it. So the two kinds
are **alternatives on one key**, resolved by recency through `supersedes` ([SD §4.1]) — not two keys
that must be kept out of one contest. §375.401(b) confirms it from the other direction: an estimate
_"must **indicate whether** it is a binding or a non-binding estimate"_, making bindingness a
property **of** the estimate rather than a separate fact about it.

`charge`'s `{aspect}` exists because without it _"an **approval** would compete with an **amount**"_
— two things that are not alternatives. Two estimates of the same total **are** alternatives. Same
mechanism, opposite answer, and the asymmetry is the point.

> **Reaffirmation-by-silence has a precedent in the model and it is worth naming:** NTS §1.6.2 makes
> `condition` assertable **by omission** ([A8 §5] row 9's note). §375.403(a)(7) is the second
> instance. Neither is minted as a record — what is published is the fact, not the silence.

### 4.3 The value is owed, on `chargeValue`'s exact reasoning

`Owed<'estimateValue', 'A7 / A12 — …'>`. The money shape is the same unsolved thing: the corpus
publishes gross / net / discount **as field names and defines them nowhere**, and `src:sirva-ade`'s
own analysis calls its trio _"genuinely ambiguous"_. Shipping a fact class with an owed value is the
**established pattern, not a workaround** — `condition`, `charge` and `notification` all do it, and
`ValueByType`'s own docstring says so: _"Four are represented as **owed**. That is the disclosure
rule applied to a value shape."_

**Bindingness rides on the owed value**, which is honest rather than convenient: the flag is part of
the shape nobody has published, so it is owed with it.

- **Family:** `goods`.
- **Authority row:** `{kind: 'role', role: 'contractingCarrier'}`, `boundBy: 'PRINCIPAL'`, per §2.
- **§375.401(h)** _"You and the individual shipper **must sign** the estimate of charges"_ is
  **already cited in the model** (in `goodsOwner`'s own docstring, noted as reaching row 11). It is a
  mutual **signature**, not joint authority over the amount — and `jointAtCustodyBoundary` is row
  9's kind, resolved through `AuthorityContext.atCustodyBoundary`, so reusing it here would bend a
  custody-boundary kind onto a contract moment. **No new holder kind is needed**, because the
  signature is not the fact.

---

## 5. `claim` — REFUSED, and the blocker written down

`claim` stays in `ABSENT_AND_OWED`, and the round's deliverable for it is that **its entry stops
being a bare string**. Today `cube`, `survey`, `estimate`, `eta`, `sealIntegrity`, `tracerResult` and
`claim` are bare members with no blocker doc, unlike `stayAuthorisation` and the rest — and that
absence is itself the defect.

**`contractingCarrier` does not close it.** The carrier **receives** a claim; the party that
**decides** it is the carrier's claims adjuster, and no member of `ROLE_NAMES` names a decider. That
is `[A8 §9 item 2]` again, and A11 (_"Claims & valuation"_) is **context-map-only by design** per
`rubric.md` — _"A10-A13 are context-map-only by design and are not gaps"_ — so there is no area
document in which the decision could even be recorded. 17 movemanager files touch it, and the model
cannot name who decides.

---

## 6. What the new role does NOT close — the honest count is THREE, not six

The option as put to the user said it unblocks six absent classes. **Measured, it unblocks three**
(`survey`, `estimate`, `claim`-as-a-documented-refusal), and the other three are different parties:

| owed to                                   | party                                            | closed by `contractingCarrier`?                                        |
| ----------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| `charge`'s `RATED` aspect — `tariffOwner` | **the van line**, _"whose tariff prices it"_     | **No** — a different party                                             |
| `stayAuthorisation`                       | **the PPSO**, a Government transportation office | **No**                                                                 |
| `stayTermination`                         | the PPSO, or a carrier acting under notice       | **No** (and its other half is a `notification` fact, `[A8 §9 item 6]`) |

Van lines and their agents are **both** household goods motor carriers, so `contractingCarrier` is
not the tariff owner on a given move. Stating six would have repeated §8.3(2)'s error in the other
direction — that round's plan said four retention states and the measurement said seven.

---

## 7. The eight gates, and the version

```
npm run test          -w @pegasus/domain-reference
npm run lint          -w @pegasus/domain-reference
npm run typecheck     -w @pegasus/domain-reference
npm run alloy         -w @pegasus/domain-reference
npm run glossary      -w @pegasus/domain-reference
npm run catalog       -w @pegasus/domain-reference
npm run context-map   -w @pegasus/domain-reference
npm run symptom-index -w @pegasus/domain-reference
```

Then **diff all six emitted files against the scratchpad baseline** and classify **from the bytes**:
expected `newClosedEnumMember` ×1 (the role) and `newRecordType` ×2, all in
{@link ADDITIVE_CHANGES} → **`0.7.0` → `0.8.0`**, with a `[catalog §2.4]` row. **Do not take that
classification from this plan** — `owed.vocabularies` gains `estimateValue`, and whether that is
carried by `newRecordType` or needs its own class is a question the emitted diff answers.

**Hot file:** `data/authority-table.json`. `git fetch && git rebase origin/main` before landing.

## 8. Gotchas carried in

1. **`git` is heavily restricted in this worktree.** Heredocs refused; so is any `git` the guard
   cannot verify stays inside the worktree. Write commit messages to a file (`git commit -F`) and
   split compound commands. Never build a message with `printf`/`echo` containing backticks.
2. **`packages/domain-reference/tools/*.ts` contain literal NUL bytes** — use `/usr/bin/grep -a`.
3. **Prettier runs in the pre-commit hook and rewrites markdown**, padding table columns. Address
   rows by **anchor text**, never by line number; any assertion over table text must be a regex.
4. **A regex over a name list that excludes digits silently drops members.** Extracting `ROLE_NAMES`
   with `[a-zA-Z.]+` returned 17 of the 19 members — `r19Agent` and `rr19Agent` were invisible. Read
   the **emitted enum** (`catalog/captured.schema.json` → `$defs.PartyRoleValue.properties.role`),
   which is the wire and cannot disagree with itself.
5. **Commit before any destructive experiment.** §8.3(2) lost an hour of unstaged work to
   `git checkout <file>`, which restores from the **index**.
6. **Verify a tamper changed the file** (`git diff --stat`) before believing red _or_ green — a
   `sed` tamper that matched nothing read exactly like a working gate.
7. **Tamper every new gate**, and ask whether each tamper changed only **one** thing.

---

## 9. Next action, after this round lands

**The round is complete and the plan above is a design record, not a resume checkpoint.** What it
leaves is named here so the next session does not re-derive it.

1. **`cube` is the narrowest gap in the model now** — the surveyed VOLUME. `survey` is published and
   one of the values it produces is not. It is blocked on **`unitOfMeasure`**, which is the one owed
   vocabulary still on the `publishedOwedVocabulary` path rather than refused, so this is a gap
   expected to close rather than one argued shut. `_SurveyResults/` is the module that pays for it.
2. **`claim` needs a DECIDER role**, not more evidence about claims. The carrier receives and
   `contractingCarrier` names it; the adjuster decides and nothing names that. Re-opening it means
   re-opening `[A8 §9 item 2]`, whose exposure row is explicit that the full role vocabulary is
   **not closable by effort** — element 98 has no counterpart for `household`, `van line`, `mover`,
   `relocat` or `moving company` across 1312 codes, and the two industry standards that would
   settle it (`src:x12-transportation`, `src:nmfta-scac`) are licensed and skipped. So a `claim`
   round has to argue an `[ORIGINAL]` role or stay refused.
3. **`tariffOwner` is now the most-cited owed role** and is a DIFFERENT party from this round's —
   the van line whose tariff prices the move. Row 11's `RATED` aspect is the only thing waiting on
   it, and `secondary` grade is what blocks it.
4. **`[A8 §9 item 4]` stays PAUSED.** This round answered its M3 question about attribution
   transfer — `PRINCIPAL` already keeps authority with the principal, so §375.409 needed no new
   machinery — but **where a second delegation axis lives is still open and still item 4's.**
