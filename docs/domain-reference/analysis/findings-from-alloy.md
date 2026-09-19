# Findings from structural model-checking

Alloy specs live in `packages/domain-reference/alloy/` and run under `npm run alloy`. The runner
exits non-zero on any finding, so these are a gate, not a report.

**A counterexample here is a finding against the binding layer, not a bug in the code.** Do not
adjust an `expect` to go green without a corresponding revision to the document it was transcribed
from.

| #   | Finding                                                                 | Status                               |
| --- | ----------------------------------------------------------------------- | ------------------------------------ |
| F1  | `handover` has no qualifier, so custody can never change hands twice    | **resolved** — 2026-09-19            |
| F2  | the fold read its `holder` off a non-authoritative `context[]`          | **resolved** — 2026-09-19, same edit |
| F3  | `handover`'s `boundBy = CUSTODY` is circular, and [A8 §5] owes it a row | **open**                             |
| F4  | `ExternallyPerformedLeg.performedBy` has no consumer                    | **open**                             |
| F5  | role-name spelling is load-bearing and the corpus spells it two ways    | **open**                             |

---

## F1 — `handover` has no qualifier, so custody can never change hands twice

**Status:** **resolved**, 2026-09-19 · **Found:** 2026-09-19, first Alloy run ·
**Against:** [SD §4.7.1] and [SD §1.3]
**Severity:** structural. It made a normal van-line move unrepresentable, and it defeated the
scenario round 2's critique singled out as the one that must work.

> **How it was resolved.** By the decision at
> [`F1-handover-qualifier-decision.md`](F1-handover-qualifier-decision.md), carried into the binding
> layer as **[SD §4.7.2f]**: `handover` declares the qualifier
> `{releasing, receiving, side, occurrence?}`, the two sides of a transfer are **two facts** rather
> than two sides of one, the releasing and receiving parties move out of `context[]` and into
> `value`, and [SD §4.8.3]'s fold gains rules **C5** (the timeline, and the transfer gap) and **C6**
> (the tie).
>
> **Applied** at [SD §4.7.1] (the row, and the act-family row's carve-out sentence), [SD §4.7.2f]
> (the argument, the four candidates, Q-KEY and H-OCCUR), [SD §4.7.3] (this finding's counterpart
> block, which now opens F2 and F3 in its place), [SD §4.8.2] and [SD §4.8.3] (the fold, C5, C6 and
> the `UNKNOWN` reasons), [SD §1.3] item 3 (the second worked case), [SD §10.1] item 24 and
> [SD §10.3a] items 9-12; and in [A8 §4.3], [A8 §5] caveat (iv), [A8 §7.1] (A8-MOVE amended),
> [A8 §7.6] and [A8 §9 item 9]. Each document's revision table carries an entry — [SD]'s revision 6
> (M, N, O) and [A8]'s revision 6 (items 13-16).
>
> **The Alloy commands that now hold** (`alloy/custody.als`, `npm run alloy`) — this finding's three
> failing commands, plus the fix's own claims:
>
> | Command                                                 | Before                         | Now                  |
> | ------------------------------------------------------- | ------------------------------ | -------------------- |
> | `check custodyAtReturnsAtMostOneHolder`                 | counterexample                 | **UNSAT** (expect 0) |
> | `check custodyAtReturnsAtMostOneHolderUnderTheFactKey`  | counterexample                 | **UNSAT** (expect 0) |
> | `run foldsUntilFieldIsReachable`                        | UNSAT                          | **SAT** (expect 1)   |
> | `run custodyChangesHandsUnderTheFactKey`                | UNSAT                          | **SAT** (expect 1)   |
> | `run unknownAcrossATransferGap` (C5)                    | —                              | **SAT** (expect 1)   |
> | `run c6ReturnsUnknownAtAnAmbiguousTie` (C6)             | —                              | **SAT** (expect 1)   |
> | `check custodyNeverMovesOnTheReleasingPartysWordAlone`  | —                              | **UNSAT** (expect 0) |
> | `check everySelectedReceiptYieldsExactlyOneHolder` (F2) | counterexample by construction | **UNSAT** (expect 0) |
>
> **No `expect` was altered**, which is the point: every one was written against what the binding
> layer claims, and the fix is what makes the claims true. Nothing that passed regressed. The
> pre-fix output below is the proof rather than a recollection — it names the expectation each
> failing command was failing _against_, and those are the expectations they carry now. (The F1
> decision's §9 edit list briefly said to "flip B1/B3's `expect`". That instruction was wrong, was
> never carried out, and is struck there; `alloy/custody.als`'s B1 comment says the same.)
>
> **The "Before" column is quoted, not reproducible — and here is what was quoted.** This package is
> untracked, so there is no pre-fix `custody.als` in the repository to re-run and the table above
> cannot be regenerated. What exists is the **"Findings against the binding layer"** block from
> **this session's first Alloy run, 2026-09-19**, before any edit — quoted as recorded, condensed
> from the runner's two-line-per-finding format:
>
> ```
>   • custody.als — custodyAtReturnsAtMostOneHolder (check): got SAT, expected UNSAT.
>   • custody.als — foldsUntilFieldIsReachable (run): got UNSAT, expected SAT.
>   • custody.als — custodyChangesHandsUnderTheFactKey (run): got UNSAT, expected SAT.
> ```
>
> Read it for what it is and no more. It is a **recorded observation** for exactly three rows —
> `custodyAtReturnsAtMostOneHolder`, `foldsUntilFieldIsReachable`,
> `custodyChangesHandsUnderTheFactKey` — and `run.mjs` lists a command in that block only when it
> _misses_ its expectation, so it is also evidence that nothing else in the module was red at the
> time. The other
> rows' **Before** cells are a **reading of the pre-fix module**, not a recorded run:
> `custodyAtReturnsAtMostOneHolderUnderTheFactKey` is not in the output above, so its "counterexample"
> cell is an inference and not an observation; the three `—` rows are commands the fix added; and
> `everySelectedReceiptYieldsExactlyOneHolder`'s "counterexample by construction" describes the old
> sig's `lone` field rather than a run. **No claim of reproducibility is made for any of it.**
>
> **And one honest qualification on the headline row.** `custodyAtReturnsAtMostOneHolder`'s new UNSAT
> follows **by construction** from rule **C6**: `holdersAt` returns `none` whenever
> `ambiguousOrderAt` holds, so the assertion cannot fail once C6 is in the fold. It is
> **definitional, not emergent**, and on its own it would prove only that the fix removed the
> question rather than answered it. What keeps it informative is three other green commands, each
> carrying a different part of the non-vacuity: `run someCustodyIsKnown` (the fold is not trivially
> empty — custody is actually known somewhere), `run c6ReturnsUnknownAtAnAmbiguousTie` (the tie is
> still **constructible**; the fold declines it rather than the model forbidding it), and
> `check custodyAtIsSingleValuedAwayFromInstantTies` (away from a tie the fold is single-valued for a
> second, independent reason — so if C6 were ever weakened, A1 would go red while A1b stayed green,
> which is the signature of a missing tie-break rather than a broken fold). This is recorded here and
> not only in `alloy/custody.als`, because a reader of the finding should not have to go find it in
> the spec.
>
> **The executable model** carries it: `data/canonical-subjects.json` (the row's `qualifier`, its
> `context[]` deletion, its now-owed authority), `src/vocabulary.ts` (`HandoverQualifier`,
> `HANDOVER_SIDES`, H-OCCUR), `src/assertions.ts` (`HandoverValuePart`, and the fact key's
> absent-`occurrence`-means-1 normalisation), `src/custody.ts` (C5, C6, the three `UNKNOWN` reasons,
> `custodyAuthorityAt`), `src/rules/authority.ts` (the owed `boundBy`, A8-MOVE amended) and
> `tests/scenarios/mid-journey-custody-handoff.test.ts`, which now runs **two** successive transfers
> and asserts the four fact keys are four rather than one.

### The mechanism

**Kept in full. A resolved finding that deletes its own history teaches nobody** — and this one's
history is the reason the Alloy suite exists at all.

Three published rules were jointly unsatisfiable:

1. **[SD §1.3]** — the fact key is the derived tuple `(subject, type, qualifier?)`.
2. **[SD §4.7.1]** — the `handover` row declared **no qualifier** (`"qualifier": null` in
   `data/canonical-subjects.json`). So every handover about one shipment keyed to `(shipment, handover)`.
3. **[SD §4.3]** — `FactResolved` selects **one** winner per fact key.

Therefore only one handover per shipment could ever be selected. A shipment that passes origin agent
→ hauler → destination agent — an ordinary interstate move — had two handovers competing as though
they were rival claims about _one_ fact, and one of them had to lose.

The two ways out were both refused by the documents as they stood:

| Take                          | Consequence                                                                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep the fact key             | The fold is single-valued but **custody can never change hands** — `custodyChangesHandsUnderTheFactKey` is UNSAT, and so is `foldsUntilFieldIsReachable`, because `until` is defined as "the next selected handover's `occurredAt`" and a second selected handover cannot exist |
| Relax the key the obvious way | The fold becomes **multi-valued at a tie** with no published tie-break — `custodyAtReturnsAtMostOneHolder` has a counterexample. [A8 §4.3] hangs authority over eight fact classes on that fold, so a two-valued answer is a two-valued authority                               |

That is **one defect, not three**: the three failing predicates are the two jaws and the hinge. The
decision had to open both jaws **and** answer the hinge, which is what **C6** is for — relaxing the
key is not enough on its own, because the tie survives it.

### Why nothing else caught it

- **Five rounds of human review missed it.** It is not visible in either rule alone; it needs the
  key rule and the handover row read together, against a two-handover history.
- **The TypeScript model passed.** `custodyAt` takes the already-selected handovers as an input, so
  it folded correctly over whatever it was given and never asked whether two selected handovers
  about one goods could exist. The scenario test therefore passed on a history the catalog could not
  publish. _(Closed from that end too: the scenario test now carries two successive transfers, and
  a block that asserts the four keys are distinct and then strips the qualifier and watches them
  collapse to one — so the old shape fails the test rather than passing it.)_
- **Alloy caught it** because the question is "does a counterexample exist", which is what it does.

### The shape of the fix, as it was described here before the decision

Kept, because the candidate the decision adopted is not the one this section expected, and the
difference is instructive.

- **`{occurredAt}`** — simple, and already the thing that distinguishes them; but two parties
  asserting the same handover at different times then key differently, which is exactly the
  competing-assertion case the fact key exists to pair. **Rejected**, and the fatal objection turned
  out to be sharper than this one: `occurredAt` **is** the contested value, so keying on it would
  make a handover time the one act time in the model that can be neither contested nor corrected.
- **`{releasing, receiving}` partyRoles** — keys by who, which pairs the `J1`/`R1` pair correctly;
  but the roles live in `context[]`, so this needs them promoted into the qualifier. **Adopted, but
  amended twice.** Promoting `partyRole` **references** would put two `SubjectRef`s in the payload,
  which [SD §1.1] forbids and [SD §4.7.2d(3)] has already refused once; they are promoted as
  **role-vocabulary members** instead. And the pair alone is not enough: `side` is added, because
  the two halves are two facts, and `occurrence`, for repeatability.
- **A custody-transfer sequence number** — unambiguous, and nothing in the corpus publishes one.
  **Rejected**, on independent derivability: the receiving agent would have to know about transfers
  it was not party to.
- **A fourth, not listed here at the time: change the subject to the juncture.** Rejected as well,
  and it was the closest of the four — see [SD §4.7.2f].

[SD §4.8.3]'s `until` ("the next selected handover's `occurredAt`") is now reachable, and A8-MOVE's
boundary has stopped being a single point — it names the **receipt** instant, and a transfer gap sits
between the two.

### Reproduce

The commands below are the **pre-fix** ones and no longer reproduce. They are kept so the finding can
be re-run against an older revision of `custody.als`; against the current one, every command matches
its expectation.

```bash
npm run alloy -w @pegasus/domain-reference
# or the single predicate:
java -jar packages/domain-reference/alloy/.tools/org.alloytools.alloy.dist.jar \
  exec -c 'custodyAtReturnsAtMostOneHolder' -t text -o - \
  -f packages/domain-reference/alloy/custody.als
```

---

## F2 — the fold read its `holder` off a non-authoritative field

**Status:** **resolved**, 2026-09-19, by the same edit as F1 · **Found:** while deciding F1 ·
**Against:** [SD §4.8.3] versus [SD §4.7.1]
**Severity:** structural, and quieter than F1 — it did not make anything unpublishable, it made the
fold's answer unattributable.

### The mechanism

[SD §4.8.3] returned `holder` _"from the selected handover's **receiving side**"_, which says a
handover record has a readable receiving side. [SD §4.7.1]'s handover row put _"the releasing and
receiving `partyRole`s"_ in **`context[]`** — and [SD §1.4] rules 2 and 3 make `context[]` valueless,
non-authoritative and **unlabelled**, so it cannot say _which_ of two refs is the receiver. The two
statements did not join, and the fold was reading an authoritative output off a field the binding
layer declares non-authoritative.

`src/custody.ts` had already recorded it as owed (`HANDOVER_RECEIVING_SIDE`) and worked around it by
taking the receiving side as a **named input** to the fold, with an `UNKNOWN` reason
(`RECEIVING_SIDE_NOT_PUBLISHED`) for a caller that could not supply one. That was honest — a caller
got `UNKNOWN` rather than a guess — but it meant [SD §4.8.3] rule 1's "**The fold reads no field that
is not [a published record]**" was false of the implementation.

### How it was resolved

[SD §4.7.2f] part (4): both parties move into `value` as `releasingParty` / `receivingParty`, where
they are asserted, attributed, contestable and **labelled**, and `partyRole` leaves the row's
`context[]` column — two homes for one link being revision 3's defect **C** ([SD §1.1]). The fold
reads `value.receivingParty` of the selected **`RECEIPT`**. The owed marker, the named input and the
`UNKNOWN` reason are retired rather than left as dead surface, and rule 1 is true of the
implementation for the first time.

Checked by `check everySelectedReceiptYieldsExactlyOneHolder` (`alloy/custody.als`, command C7),
which had a counterexample by construction before the fix because `Handover.receiving` was `lone`.

### What it leaves open, recorded rather than smoothed over

[SD §4.8.3] rule 1 still names _"that leg's declared `custodyBasis` and **`performedBy`**"_ as the
fold's other input, and [SD §4.7.2f] leaves `ExternallyPerformedLeg` unchanged. But the amended fold
sources `holder` from the receipt's `value.receivingParty` **full stop**, so `performedBy` no longer
has a consumer, and nothing published says the two must agree.
`run legPerformerCanDisagreeWithTheReceiptAndTheFoldReadsTheReceipt` (command C8) builds that state
and is `expect 1`, because it is constructible under the documents as they stand. Whether
`performedBy` becomes a cross-check, a fallback, or is struck from rule 1 is **[SD §4.8.3]'s to
decide**, and is not decided here. **Recorded on its own line as F4**, below, so that it is countable
rather than buried in a resolved finding's coda.

---

## F3 — `handover`'s `boundBy = CUSTODY` is circular, and [A8 §5] owes it a row

**Status:** **open** · **Found:** while deciding F1 · **Against:** [SD §4.7.1] versus [SD §4.8.2],
and [A8 §5]
**Severity:** a contradiction between two published sentences, which F1's fix makes load-bearing.

### The mechanism

[SD §4.7.1] gave the `handover` row `boundBy = CUSTODY`. [SD §4.8.2] says of the **identical shape**,
while refusing a `custody` fact class:

> _"that row's binding would be `CUSTODY`, so **A8-MOVE would be defined in terms of the thing it
> defines**. The fold breaks the circle — `handover`'s authority is decided on its own row."_

The two sentences contradict each other. It was survivable while the fold read one handover and
nobody asked which side won a disagreement. F1's fix makes it load-bearing, because the fold now
depends on **selecting among paired handover assertions** — so "which of two assertions about one
side of one transfer wins" is a question the model asks on every transfer, and answering it through
`CUSTODY` would answer it through the fold that consumes the answer.

There is a second half. **[A8 §5] has no `handover` row** — [SD §4.7.1]'s handover row cites
[A8 §7.1] and [A8 §7.6] precisely because §5 has none — and under **A8-NAMED** ([A8 §4.4]) a
`FactResolved` over an empty or plural authority **MUST** name a tie-break rule. There is no rule to
name.

### What has been done, and what is owed

**Done.** [SD §4.7.1]'s row reads `boundBy` **owed, expressly not `CUSTODY`**, and the row's
authority `status` is `owed` in `data/canonical-subjects.json` — which takes the table's owed-row
count from 18 to 19, and that increase is the gap becoming countable rather than a regression.
[A8 §5] gains caveat (iv) saying the row is owed and why. `src/rules/authority.ts` carries the same,
and the scenario test asserts the binding is not `CUSTODY`.

**The provisional reading**, **[ORIGINAL]** and **do not score**: authority for a key belongs to the
role named on that key's own `side` — the releasing role for `RELEASE`, the receiving role for
`RECEIPT`. It breaks the circle because it reads the **key**, not the fold, and it is
`src:stedi-x12-reference`'s own arrangement (only the releasing carrier issues `J1`; only the
receiving carrier issues `R1`).

**Owed to [A8]:** whether that reading is right; whether it is a sixth `boundBy` member or `NONE`
plus a named rule; and the [A8 §5] row itself, without which A8-NAMED has nothing for a handover
resolution to name.

### Reproduce

Not an Alloy finding — it is a contradiction between two sentences, and Alloy does not read prose.
It surfaced because `alloy/custody.als` had to decide what `FactResolved` does with a handover
contest in order to model F1's fix, and found no published rule to transcribe (see the module's
`FactResolved` comment, and command A4).

---

## F4 — `ExternallyPerformedLeg.performedBy` has no consumer

**Status:** **open** · **Found:** while applying F1's fix · **Against:** [SD §4.8.3] rule 1 versus
[SD §4.8.3]'s own amended fold table
**Severity:** a published input with nothing reading it. Not a contradiction between two sentences
like F3 — a field the documents keep naming as an input and the fold no longer consults.

### The mechanism

[SD §4.8.3] rule 1 still names _"that leg's declared `custodyBasis` and **`performedBy`**"_ as the
fold's other input, and [F1 §7.5] leaves `ExternallyPerformedLeg` expressly unchanged. But §7.1's
amended table sources `holder` from **the selected `RECEIPT`'s `value.receivingParty`** — full stop.
So after the fix `custodyBasis` still has a consumer (`basisOf` prefers the leg's, which is what rule
1 requires) and **`performedBy` has none**.

Nothing published says the two must agree. A leg may declare that H performs it while the selected
receipt for the same goods names D as the receiving party, and the fold answers **D** without
remarking on the disagreement — no `UNKNOWN`, no reason, no flag.

`run legPerformerCanDisagreeWithTheReceiptAndTheFoldReadsTheReceipt` (`alloy/custody.als`, command
C8) builds exactly that state and is **SAT**, which is what it is `expect 1` for: the state is
constructible under the documents as they now stand, so this is not an implementation slip the fix
left behind but a question the fix does not answer.

### Why it is recorded rather than decided

Three dispositions are open and they are materially different:

- **A cross-check** — the fold reads the receipt and emits an `UNKNOWN` or an integrity signal where
  the leg disagrees. Strictest; costs a new reason and a new failure mode at ingest.
- **A fallback** — the leg's `performedBy` answers where no selected receipt names a party. Closest
  to the old behaviour (the pre-fix `holderOf` fell back to `namesLeg.performedBy`), and the one that
  risks reopening foreclosure 2, because a leg is **our** record of **their** undertaking: falling
  back to it would let custody move without the receiving party having spoken.
- **Struck from rule 1** — `performedBy` stays on the record as an attribute of the undertaking and
  stops being described as a fold input.

Choosing among them is **[SD §4.8.3]'s**, not this file's, and not the executable model's. The model
implements the amended table exactly: it reads the receipt, and it does not consult `performedBy`.

### Reproduce

```bash
npm run alloy -w @pegasus/domain-reference
# the single command:
java -jar packages/domain-reference/alloy/.tools/org.alloytools.alloy.dist.jar \
  exec -c 'legPerformerCanDisagreeWithTheReceiptAndTheFoldReadsTheReceipt' -t text -o - \
  -f packages/domain-reference/alloy/custody.als
```

---

## F5 — role-name spelling is now load-bearing, and the corpus spells it two ways

**Status:** **open** · **Found:** while applying F1's fix · **Against:** [A8 §2] versus
[SD §4.7.2f] and [A8 §7.6]
**Severity:** structural, and of a kind no test in this package can catch, because both spellings are
well-formed strings.

### The mechanism

Before F1, a role name was a label on `assertedBy` — a mis-spelling made a record hard to read.
**After F1 it is a fact-key component.** [SD §4.7.2f] puts `releasing` and `receiving` in
`handover`'s qualifier, and [SD §1.3] derives the fact key from `(subject, type, qualifier?)`. So
`{releasing: originAgent, …}` and `{releasing: OriginAgent, …}` are **two fact keys**, which means
two facts that never pair and never contest — the silent failure mode H-OCCUR's residual risk was
named for, one component to the left, and without H-OCCUR's saving grace: an `occurrence = n` with no
`n−1` is a detectable integrity query, whereas two spellings of one role look like two legitimate
transfers.

**And [A8 §2] carries both.** Rule **A8-NAME-1** fixes the agent roles in lower-camel —
_"`originAgent`, `destinationAgent`, `loadAgent`, `unloadAgent`, `sitAgent`, `r19Agent`,
`rr19Agent`"_ — and A8-NAME-2 adds `accountParty` and `goodsOwner` in the same style. The same
section then says **"the role vocabulary this document takes is `src:sirva-ade`'s cast"** and lists
it capitalised: `Booker` · `OriginAgent` · `DestinationAgent` · `LoadAgent` · `UnloadAgent` ·
`Hauler` · `R19Agent` · `RR19Agent` · `SITAgent` · `Driver`, plus `Packer` / `PortHandler` /
`SettlingAgent` / `SetoffAgent`. [A8 §7.6]'s worked records use the capitalised spelling inside the
qualifier itself (`qualifier={releasing: OriginAgent, receiving: Hauler, side: RELEASE}`). Nothing
cross-checks the two lists, and `SITAgent` versus `sitAgent` is not even a pure case fold.

### What the executable model does about it, and what it does not

`src/envelope.ts`'s `ROLE_NAMES` **pins one spelling** — lower-camel throughout, on the stated ground
that A8-NAME-1 is a _rule_ and the ADE cast is a _citation_, so the rule wins and the rest of the
cast is spelled to match. `HandoverQualifier.releasing` / `.receiving` are typed `RoleName`, so the
package cannot construct a capitalised handover key at all.

That is a **local** decision by an implementation, and it must not be mistaken for the answer. It
pins the spelling for anything built from this package and does nothing for a partner feed, for
[A8 §7.6]'s own records, or for a second implementation reading A8 §2 and taking the cast at its
word. [A8 §9 item 2] already owes _"the full role vocabulary as a versioned enum"_; F1 raises what
that debt now costs, because the enum's **spelling** is a fact-key component and not a presentation
choice.

**Owed to [A8]:** the canonical list, spelled once, with the ADE cast recorded as the _source_ of the
names rather than as a second set of them — and a statement of whether a role name is
case-significant on the wire.

### Reproduce

Not an Alloy finding: `alloy/custody.als` models `Role` as an opaque signature, so a spelling
difference there is simply two atoms — which is precisely the point, and precisely why Alloy cannot
raise it. It is checkable by reading [A8 §2]'s two lists against
`packages/domain-reference/src/envelope.ts`'s `ROLE_NAMES` and [A8 §7.6]'s qualifier records.
