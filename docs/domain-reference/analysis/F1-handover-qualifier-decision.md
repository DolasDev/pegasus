# F1 — how successive handovers become distinct facts

**Status: decided and APPLIED, 2026-09-19.** This file is the argument and the edit list. Every edit
in §9 has landed: in [`00-shared-decisions.md`](00-shared-decisions.md) (the §4.7.1 row and the
act-family sentence, **§4.7.2f**, §4.7.3, §4.8.2, §4.8.3's fold with C5 and C6, §1.3 item 3, §10.1
item 24, §10.3a items 9-12, and revision 6's entry), in
[`A8-authority-skeleton.md`](A8-authority-skeleton.md) (§4.3, §5 caveat (iv), §7.1's amended
A8-MOVE, §7.6, §9 item 9, and revision 6's entry), and in the executable model
(`data/canonical-subjects.json`, `src/vocabulary.ts`, `src/assertions.ts`, `src/custody.ts`,
`src/rules/authority.ts`, `alloy/custody.als`, and the scenario, conformance and invariant tests).
`F1` in [`findings-from-alloy.md`](findings-from-alloy.md) is **resolved**; **F2** is resolved by the
same edit; **F3** is open and is [A8]'s.

§8's acceptance criteria all hold — `npm run alloy` reports every command matching its expectation,
with no `expect` altered.

**Authority.** [`00-shared-decisions.md`](00-shared-decisions.md) binds (`[SD]` below);
then [`A8-authority-skeleton.md`](A8-authority-skeleton.md) (`[A8]`); then
[`A3-trip-stop-assignment.md`](A3-trip-stop-assignment.md) (`[A3]`),
[`fork-order-shipment-cardinality.md`](fork-order-shipment-cardinality.md),
[`fork-time-provenance-corrections.md`](fork-time-provenance-corrections.md). This decision is a
**[SD §4.7] decision**, which is what [SD §4.7.3]'s own defect note says it must be: _"Not fixed
here — giving `handover` a qualifier is a §4.7 decision."_

**Disclosure.** Every claim below cites a source that says **that** thing, or is marked
**[ORIGINAL]** at the point of use. `[SYNTHESIS]` marks a mechanical join of two sourced halves.
Our own systems are not evidence ([SD §0]).

---

## 0. The decision

> **Decision, in four parts.**
>
> **(1) The releasing party and the receiving party assert TWO facts, not two sides of one.** The
> pairing unit is **one side of one transfer**, not the transfer.
>
> **(2) The subject does not move.** `handover`'s canonical subject family stays **`goods`** =
> {shipment, portion}. Candidate (d) is rejected.
>
> **(3) `handover` declares the qualifier**
>
> ```
> qualifier { releasing   roleRef        a member of the published role vocabulary [A8 §2]
>             receiving   roleRef        idem
>             side        RELEASE | RECEIPT
>             occurrence  integer ≥ 1    OPTIONAL; absent means 1 }
> ```
>
> so the fact key is `(goods, handover, {releasing, receiving, side, occurrence?})`.
>
> **(4) The two parties move out of `context[]` and into `value`.** `handover`'s `value` is
> `{occurredAt, outcome, reasons[], custodyBasis, releasingParty, receivingParty}`. [SD §4.8.3]'s
> fold reads `holder` from `value.receivingParty` of the selected **RECEIPT**, never from
> `context[]`.

This is candidate **(b)**, amended twice: the finding's `partyRole` _references_ are replaced by
**role-vocabulary members** (which is what makes R4 pass and R3 pass), and two components are added
— `side`, forced by the R2 verdict in §2, and `occurrence`, forced by R5 in §6.

---

## 1. The defect, restated only as far as is needed

Three published rules are jointly unsatisfiable ([`findings-from-alloy.md` F1]):

1. the fact key is the derived tuple `(subject, type, qualifier?)` [SD §1.3];
2. [SD §4.7.1]'s `handover` row declares **no qualifier**, so every handover about one shipment keys
   to `(shipment, handover)`;
3. `FactResolved` selects **one** winner per key [SD §4.3].

So custody can never change hands twice, [SD §4.8.3]'s `until` ("the next selected handover's
`occurredAt`") is unreachable, and relaxing the key naively makes the fold multi-valued at an
`occurredAt` tie with no published tie-break — while [A8 §4.3] hangs eight fact classes' authority on
that fold. Any fix must therefore also say what the fold does at a tie; §5 rule **C6** does.

---

## 2. R2 settled first: one fact or two?

**Verdict: TWO facts.** `[SD §4.8.3]`'s phrase _"the selected handover's receiving side"_ — the one
sentence that reads like a single record carrying both sides — is the loser, and the sentence that
beats it is **in the same subsection**.

### 2.1 What decides it

**(a) [SD §4.8.3] rule 3 counts them as two, and describes behaviour only two facts can produce.**
Rule 3: _"Before the first handover, and **across a cross-dock dwell where only one of the two
handovers has been published**, the fold returns `UNKNOWN`."_ [A3 §8] repeats it verbatim: _"Where
only one of the two handovers has been published the fold returns `UNKNOWN`"_. Two things follow.
The documents call them _"the two handovers"_ — plural facts, not two assertions of one. And the
behaviour is underivable on the one-fact reading: if the release and the receipt were one contested
fact, a lone `J1` would be a contest of one, `FactResolved` would select it, and the fold would
report custody moving on the releasing party's word alone. Rule 3 says it does not.

**(b) ~~[A8 §7.6] publishes a `FactResolved` for the pair it treats as one fact, and none for the
handover pair.~~ WITHDRAWN — 2026-09-19, and struck rather than quietly deleted.** As argued, this
read the worked scenario's records: the two `condition` assertions carrying **identical**
`context = [shipment:S, stop:X]` and resolved by
`FactResolved subject=item:i7 factRef=(item:i7, condition) considered=[A's, H's] selected=∅`, against
two `handover` records carrying **different** `context[]` and **no `FactResolved` at all**.

**§9's own edits made it false of the document it cites.** Applying this decision gave [A8 §7.6]'s
two handover records a `FactResolved` **each** (A8 revision 6 item 15), and split the `stop:X` those
`condition` records shared into `stop:X1` / `stop:X2`. Neither half of the contrast survives. Nor may
it be restated against the amended text: §7.6 was amended **by this decision**, so reading its new
records back as grounds for the decision is circular. (a), (c), (d), (e) and (f) are independent of
§7.6 and carry the verdict without it; the strongest, (a), is settled text this decision did not
touch. Carried into [SD §4.7.2f] as a withdrawn item there too.

**(c) [A8 §9 item 9] answers the question in as many words.** It records `src:stedi-x12-reference`'s
own open question 5 — _"How do we represent custody transfer — one event or two?"_ — and answers:
_"§7.6 answers **two** (the `J1`/`R1` shape), but that is our answer, not stedi's."_

**(d) The corpus's word is `complementary`, and [SD §4.3]'s machinery is for `competing`.**
`src:stedi-x12-reference` element 1650 carries **two codes** — `J1` Delivered to Connecting Line and
`R1` Received from Prior Carrier — which the stedi analysis describes as _"two complementary
assertions by two different [parties]"_ ([A8 §7.1], [SD §4.8.2]). [SD §4.3] pairs **competing**
assertions and picks a winner; complementary assertions have no winner to pick, because they do not
contradict. A release at 14:00 and a receipt at 16:00 are both true.

**(e) One fact cannot carry two outcomes, and [SD §2] makes `outcome` mandatory on every act.** A
release can complete while the receipt fails — the receiving carrier refuses the goods on the dock.
Under one fact that is one `outcome` field for two acts with different results; under two facts it is
`RELEASE` `COMPLETED` and `RECEIPT` `NOT_COMPLETED` with a reason, which [SD §2.3] already requires.
**[ORIGINAL]** as an argument; the mechanism is settled text.

**(f) The one-fact reading publishes a fabrication.** M1's argument, quoted at [SD §4.6.1(a)] — _"a
planned value that nothing contradicted is indistinguishable from an observation, which is the
difference between a record and a fabrication"_ — applies exactly: moving custody to a party that has
not said it took custody publishes a standing nobody claimed.

### 2.2 The counter-evidence, stated rather than buried

- **`src:open-trip-model`'s `HandOver`** _"indicates transferring a consignment from one Actor to
  another"_ and **carries `from`/`to` actor refs** ([SD §8.3]) — one act record with two ends. This is
  real evidence for the one-fact reading and it is why §0(4) puts both parties on **both** records'
  `value`: OTM's shape is preserved field-for-field; what is not preserved is the claim that one
  publisher's record settles both sides.
- **[SD §4.8.3]'s `"receiving side"` gloss.** Under this decision it reads: the receiving side **of
  the receipt** — which is that record's own authoritative `value.receivingParty`, not an unlabelled
  `context[]` entry. See §7.

### 2.3 What survives of R2

R2's requirement is not discarded; its _unit_ is corrected. **Where two parties speak about the same
side of the same transfer, they pair.** The driver and the origin agent both asserting A's release;
the hauler and the platform both asserting H's receipt; a `DestinationAgent` asserting a receipt the
`Hauler` also asserts — each of those is one key with a real contest, resolved by `FactResolved` in
the ordinary way ([SD §4.3], [SD §4.5]). What no longer pairs is the release against the receipt,
because they were never the same fact.

---

## 3. The test a qualifier has to pass

Three qualifiers are published: `identity`'s `{scheme, vocabularyScope}` ([SD §7.1] I-KEY),
`pieceCount`'s `{unitization}` ([SD §4.7.2a]), `charge`'s `{aspect}` ([SD §4.7.2b]). All three share
a shape that no document states. Stating it is **[ORIGINAL]**; every input is settled text.

> **Rule Q-KEY [ORIGINAL].** A `qualifier` component must be **(i)** a member of a published
> vocabulary or a small closed domain — not a reference to an aggregate; **(ii)** computable by every
> party entitled to assert the fact, from what that party holds at assertion time; and **(iii)** not
> itself a value under contest for that fact.

- **(i)** is [SD §1.1]'s prohibition on a second subject read at the right grain: `scheme`,
  `unitization` and `aspect` are vocabulary members, not `SubjectRef`s.
- **(ii)** is what makes the key a _pairing_ device at all ([SD §1.3]: _"Competing assertions pair on
  this key"_). A key one party cannot compute is a key that never pairs.
- **(iii)** is forced by [SD §4.3]: a key component that is under contest makes the contest
  disappear, because two parties who disagree about it key differently and never meet. Note that
  none of the three published qualifiers contains the value being asserted — `weight.net` does not
  key on the weight.

Q-KEY is the reason (a), (c) and the finding's own spelling of (b) all fail, and it is checkable
against the three rows that already exist.

---

## 4. The four candidates

### (a) `{occurredAt}` — rejected

- **R1 ✓ / R5 ✓ / R3 ✓** — each party knows its own clock.
- **R2 ✗ in its surviving form (§2.3).** Two parties asserting the _same side_ at different times
  never pair: the driver's release at 14:00 and the origin agent's release at 14:05 become two facts
  and the contest the fact key exists for cannot happen.
- **Q-KEY(iii) ✗, and this is the fatal one.** `occurredAt` **is** the contested value — it sits in
  `value` on every act record ([SD §4.1], [SD §2]) and the whole of [SD §4.2]'s three-clock apparatus
  exists because parties disagree about it. Keying on it means no two handover assertions ever
  compete, `FactResolved` is always a contest of one, and `supersedes` — constrained to _"the SAME
  party with the SAME fact key"_ ([SD §4.1]) — can never link a corrected time to the time it
  corrects, because correcting the time changes the key. A handover time would be the one act time in
  the model that cannot be contested or corrected.
- **Worse on the wire we actually carry:** `src:sirva-ade`'s event `DateTime` _"indicates when event
  was **recorded**"_ and there is no occurred-at anywhere in the operational payload ([A8 §4.2]), so
  the component would frequently be a recording clock keyed as if it were an occurrence clock.

### (b) `{releasing, receiving}` partyRoles — rejected **as the finding spells it**, adopted amended

As `partyRole` **references**:

- **R4 ✗ — yes, it is the same violation [SD §4.7.2d(3)] names.** `partyRole` is an `aggregate`
  ([SD §1.2]) with a `partyRole`-subject fact class of its own ([SD §4.7.3]), so a qualifier carrying
  two `partyRole` refs puts two `SubjectRef`s in the payload, which is what [SD §1.1] forbids
  permanently. Q-KEY(i) ✗.
- **R3 ✗.** A `partyRole` id is **ours**. The interline hauler receiving from a prior carrier does
  not hold it, and [A8 §9 item 1] records that the party entity does not exist yet, so there is no
  identifier either side could exchange. Two parties cannot compute the same key.
- **Q-KEY(iii) ✗.** _Which_ party received is itself contestable — it is exactly what
  `value.receivingParty` is for.

As **role-vocabulary members** (`OriginAgent`, `Hauler`, `DestinationAgent`, …), all three objections
dissolve, and that is the amended form adopted at §0(3). See §5 and §6 R4.

### (c) A custody-transfer sequence number — rejected

- **Nothing in the corpus publishes one** (the finding says so, and nothing found here contradicts
  it).
- **R3 ✗.** The receiving agent would have to know it is the third transfer — i.e. know about
  transfers it was not party to. That is precisely _"a shared view of history they may not have"_.
  `src:sirva-ade`'s own analysis supplies the operational fact that makes this concrete: _"an agent
  cannot see the trip"_ ([A3 §3.3]).
- **Circular.** A global ordinal counts _selected_ handovers; selection runs per fact key; the key
  would contain the ordinal. The count depends on the resolution it feeds.
- **M1 ✗ if the platform mints it.** A catalog-assigned ordinal is a value nobody asserted, published
  as though somebody had — the shape [SD §4.6.1(a)] refuses one field to the left.

### (d) Change the subject to the juncture — rejected, and it is the closest of the four

The analogy is real and is worth stating before it fails: [SD §4.7.1]'s act-family row does carve out
exactly this shape — _"`arrival` and `departure` are **not** in this family: they are time facts about
a *visit*, which is why their family is `stop`."_ Three things kill it.

**(d.1) `externallyPerformedLeg` is a span, not a juncture — so F1 reappears inside it.** [SD §8.2]:
_"Acts are published against it exactly as against a stop: **handover-out, handover-in**, delivered,
placed in SIT."_ One leg carries the handover that opens it **and** the handover that closes it. Same
subject, same type, no qualifier — the defect returns unchanged, and closing it would need a
`{direction}` qualifier anyway, which is the thing (d) claims to avoid.

**(d.2) One transfer is two `stopAction`s, so the two sides name different subjects.** [A3 §3.2]
defines a `StopAction` as _"one act performed on one shipment (or on one `Portion` of it) at one
stop, naming exactly one shipment-or-portion and **exactly one stop**"_, and [SD §8.1] fixes a `Stop`
as _"a visit to one place, at **one position in one trip's sequence**"_. The releasing side's stop is
on trip 1 and the receiving side's is on trip 2 — [A3 §8] says so in as many words: _"the releasing
side against a stop on trip 1, the receiving side against a stop on trip 2"_. There is no single
published juncture for both sides to name. ([A8 §7.6] **used to** write one `stop:X` on both
records, contradicting [SD §8.1]; that was a transcription slip in the worked example, not a licence
for one stop on two trips, and §9's edits corrected it to `stop:X1` on T1 and `stop:X2` on T2. The
same slip stood in `tests/scenarios/mid-journey-custody-handoff.test.ts`, on both transfers, and is
corrected there the same way.)

**(d.3) R3 ✗ in the case the model was extended for.** Even granting one juncture, the receiving
interline hauler cannot name our `stopAction`; it cannot see our trip. And where the receiving
party's journey is invisible, [SD §8.2]'s `ExternallyPerformedLeg` is _our_ record of _their_
undertaking, minted by us — the counterparty cannot key on it at assertion time.

**And the cost to the fold, which is what the question asked.** [SD §4.8.3] folds `custodyAt(goods,
instant)` and rule 1 restricts its inputs to _"`FactResolved`-selected `handover` assertions and
nothing else"_. Under (d) the fold could no longer read the goods off the handover: it would traverse
`stopAction → shipment` or `leg → shipment`, so **E-CANON's structural admission check would no
longer guarantee that a handover is about goods at all** ([SD §4.6.2] E-CANON-STRICT is purely a check
on `subject.aggregate`). And (d) contradicts the act family's own general rule in the row that states
the `arrival`/`departure` exception: _"an act's canonical subject is the aggregate the act is
performed **on**"_. You hand over **goods**; you do not hand over a `stopAction`. The `arrival`
carve-out survives because a _visit_ is the thing arrived at — there is no equivalent noun here.

---

## 5. The decision, stated so it is testable

**Family:** `goods` = {shipment, portion}. Unchanged. `subject-admission.als` and every E-CANON
consequence are untouched.

**Qualifier components.**

| Component    | Domain                              | Why it is in the key                                                                                                                                                     | Mark                                                                                                        |
| ------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `releasing`  | published role vocabulary ([A8 §2]) | Which transfer. `src:open-trip-model`'s `HandOver` carries `from`/`to` actor refs ([SD §8.3]); `src:stedi-x12-reference` `R1` names the counterparty's position outright | **[SYNTHESIS]** — the two ends are sourced; rendering them as key components is the join                    |
| `receiving`  | idem                                | idem                                                                                                                                                                     | **[SYNTHESIS]**                                                                                             |
| `side`       | `RELEASE` \| `RECEIPT`              | §2's verdict. `src:stedi-x12-reference` element 1650 publishes the two halves as **two codes**, `J1` and `R1`                                                            | **Sourced** that the halves are separately reported; **[ORIGINAL]** that they are one type with a qualifier |
| `occurrence` | integer ≥ 1, OPTIONAL, absent = 1   | R5 only                                                                                                                                                                  | **[ORIGINAL]**                                                                                              |

**Why a qualifier and not two types.** [A3 §3.2] rules that `transfer-out` and `transfer-in` are
_"**one `handover` type, asserted once by each side** — the `J1`/`R1` shape … **not two types**"_,
and [A3 §8] repeats it. [SD §4.7.2a]'s `pieceCount` is the precedent for the remedy: two
independently contested facts about one subject become **one type with a qualifier**, not two types.
So the corpus's two constraints — _one type_ and _two facts_ — have exactly one solution, and this is
it. **[ORIGINAL]** as the inference; both premises are quoted.

**Why role members and not party references.** `assertedBy` is `{partyRef, role}` and _"role rides on
the assertion"_ ([SD §1.1]); the role vocabulary is published at [A8 §2] (`src:sirva-ade`'s
`Resource.Type` cast, plus four additions). A `roleRef` is a vocabulary member exactly as `scheme` is,
so Q-KEY(i) holds, and both parties can compute it: the releasing agent knows it is handing to the
linehaul hauler, and the receiving hauler knows it took from the prior carrier — which is what the
X12 code _names_ (`R1` **Received from Prior Carrier**).

**Where the parties' identities live.** In `value`, not in the key and not in `context[]`. The
precedent is settled text: `identity`'s `value` carries `issuer`, _"the PARTY that assigned this id
under that scheme"_ ([SD §7.1]). A party reference in a `value` is not a second subject; it is an
asserted, contestable fact about the transfer — which is precisely what it needs to be, because the
two sides can disagree about who took the goods. **Grain is owed**: [SD §4.8.3] returns `holder` as a
`partyRole` while [SD §8.2]'s `performedBy` is a party, and [A8 §9 items 1–3] owe the party entity and
the person-vs-organisation grain. Do not invent it here; carry the union
(`packages/domain-reference/src/custody.ts` `CustodyHolder` already does).

**The `occurrence` rule, and why it is not candidate (c).**

> **Rule H-OCCUR [ORIGINAL].** `occurrence` counts, from 1, the transfers of **this subject** in which
> **this ordered role pair** stood in these positions, on **this side**. It is absent — meaning 1 —
> unless a party is asserting the second or later such transfer. A party computes it from its own
> dealings with its own counterparty over this shipment, never from the catalog's resolved history.

The difference from (c) is the whole of R3. (c) requires knowing about transfers you were not party
to; H-OCCUR requires knowing only the ones you performed, against the counterparty named in the same
key, on the shipment named in the subject. There is no circularity: the count is over the asserting
party's own acts, not over `FactResolved`'s output. And because §2 makes each side its own fact, the
parties who have to agree on `occurrence` are the corroborators of **one side** — usually one
organisation's driver and its office — not the two sides of an arm's-length interline transfer.

**Its residual risk, named rather than hidden.** A mis-counted `occurrence` splits one side's
assertions into two keys that never pair. That failure is **detectable**: an `occurrence = n` key with
no `occurrence = n−1` key on the same subject and side is a catalog integrity query, and so is one key
carrying two assertions by the same party at `basis = ACTUAL` with no `supersedes` between them.
**[ORIGINAL]** as a query; it is the difference between this component and candidate (a), whose
failure mode is silent.

---

## 6. The five requirements, checked

**R1 Succession — ✓.** Origin agent → hauler → destination agent publishes four facts on four keys:
`{OriginAgent, Hauler, RELEASE}`, `{OriginAgent, Hauler, RECEIPT}`, `{Hauler, DestinationAgent,
RELEASE}`, `{Hauler, DestinationAgent, RECEIPT}`. Two custody spans, two boundaries. Interline
hauler-to-hauler also separates without an ordinal, because the counterpart role differs:
`{Hauler, Hauler, RELEASE}` then `{Hauler, DestinationAgent, RELEASE}`.

**R2 Pairing — ✓, in the form §2 establishes.** The releasing and receiving parties do **not** assert
one fact, so they are not required to share a key. Two parties speaking about the _same side_ of the
same transfer share every component and pair.

**R3 Independent derivability — ✓.** Each component is computable at assertion time from what the
asserting party holds: its own role and its counterparty's role (`src:dp3-tender-of-service` §B.3.f
makes the party actually hauling a **nameable** legal party with a DOT number within 2 GBD, so the
counterpart role is knowable and is a regulatory duty, not a convenience); its own side; its own
bilateral count. No shared view of anyone else's history.

**R4 No subject in the payload — ✓, and the finding's own spelling of (b) ✗.** The question is
whether a qualifier carrying partyRole refs is the violation [SD §4.7.2d(3)] names. **It is** — see
§4(b) — and that is why this decision does not carry them. A `roleRef` is not a `SubjectRef`; there is
no aggregate id in the qualifier, no path, and nothing the resolution rule could mistake for a second
subject of the fact.

Two tests separate this from [SD §4.7.2d(3)]'s refused case, and both are **[ORIGINAL]** as tests
while every input is settled text:

1. **Could the referenced thing be the subject of _this_ fact?** For `tripDelay` + "the stop it
   moves": yes — a stop is the canonical subject of `arrival`/`departure`, so naming it in the
   qualifier makes the record ambiguous between a trip fact and a stop fact, which is exactly the
   undecidability [SD §1.1] forbids. For `handover` + role names: no — there is no reading on which
   "custody of S passed from the origin agent to the hauler" is a fact **about** a role-holding. The
   `partyRole`-subject class is facts about the role-holding itself ([SD §4.7.3]).
2. **Is it a reference or a vocabulary member?** [SD §4.7.2d(3)]'s refused qualifier named _which_
   delay by pointing at another aggregate. This one names a **position in the act** from a closed
   list, as `scheme` does.

**R5 Repeatability — ✓ via H-OCCUR.** The same ordered role pair transferring the same goods twice
publishes `occurrence = 1` and `occurrence = 2` on each side. Note the common HHG instances resolve
before H-OCCUR is needed: a shuttle making two trips moves two **Portions**, which are two subjects
under the `goods` family ([SD §3.3]); and the reverse direction has the reversed pair.

---

## 7. Consequences

### 7.1 [SD §4.8.3]'s fold

The fold's shape changes in three places and gains two rules. `until` becomes **reachable**, which was
one of F1's three failing predicates.

```
custodyAt( goods : shipment | portion , instant )  →
    { holder      partyRole | party   the selected RECEIPT's value.receivingParty
      basis       41 | 349            that receipt's custodyBasis, or the leg's
      since       instant             that receipt's occurredAt
      until       instant?            the occurredAt of the next selected RELEASE by that holder,
                                      where one exists
      evidencedBy eventId[]           every handover assertion and FactResolved the fold read }
  | UNKNOWN( reason )
```

Rules 1–4 stand as written. Rule 3's two named `UNKNOWN` cases are now **derived** rather than
stipulated, which is itself evidence for §2's verdict. Two rules are added:

> **C5 [ORIGINAL] — the timeline.** A goods' custody timeline is the time-ordered sequence of its
> selected `RECEIPT` and `RELEASE` facts at `basis = ACTUAL`. A `RECEIPT` opens a span; the next
> `RELEASE` by that holder closes it; **between a `RELEASE` and the next `RECEIPT` the fold returns
> `UNKNOWN`**. That gap is [SD §4.8.3] rule 3's cross-dock dwell and [A3 §8]'s _"thin part"_, now
> produced by the fold rather than asserted about it. A `RELEASE` whose holder is not the open span's
> holder does not close it and yields `UNKNOWN`; the fold never reconciles an inconsistent sequence.

> **C6 [ORIGINAL], and it is the half F1 said was missing — the tie.** Where two selected handover
> facts about one goods carry the **same** `occurredAt` and would open and close differently, the fold
> returns `UNKNOWN`. It does not order them by key, by `assertedAt`, by `recordedAt` or by
> `occurrence`. This is **A8-NAMED** ([A8 §4.4]) in its custody-side form and [SD §4.6.3] step 2's
> refusal to fall through, applied to ordering instead of to selection.

`UNKNOWN` reasons become: `NO_SELECTED_HANDOVER_AT_OR_BEFORE_INSTANT`, `IN_TRANSFER_GAP` (C5),
`AMBIGUOUS_ORDER_AT_INSTANT` (C6). `RECEIVING_SIDE_NOT_PUBLISHED` is **retired** — see §7.2.

### 7.2 The receiving side — a second defect, closed by the same edit

`packages/domain-reference/src/custody.ts` already records it as owed
(`HANDOVER_RECEIVING_SIDE`): _"[SD §4.8.3] returns `holder` 'from the selected handover's **receiving
side**' … [SD §4.7.1]'s handover row puts 'the releasing and receiving `partyRole`s' in `context[]` —
and [SD §1.4] rules 2 and 3 make `context[]` valueless, non-authoritative and unlabelled, so it
cannot say *which* of two refs is the receiver. The two statements do not join."_ The fold was reading
an authoritative output off a non-authoritative field. §0(4) closes it: the parties move into `value`,
where they are asserted, attributed, contestable and labelled. **Recommend recording this as F2 in
[`findings-from-alloy.md`](findings-from-alloy.md)** and marking it closed by the same edit, so the
repair is not read as incidental.

### 7.3 [A8 §7.1] A8-MOVE and the boundary

A8-MOVE says authority moves _"effective at the handoff instant"_. There are now two instants, and the
rule must name one.

> **A8-MOVE, amended [ORIGINAL].** Authority over every `boundBy = CUSTODY` fact class moves at the
> selected **`RECEIPT`**'s `occurredAt`, on that receipt's `custodyBasis`: `349` moves it to the
> receiving role; `41` moves custody and not authority. Across a transfer gap (C5) the **releasing
> role remains authoritative** until the receipt, so the gap is a custody `UNKNOWN` and not an
> authority vacuum.

Sourced: nothing new — 41 vs 349 is `src:uncefact-rec24`, quoted at [A8 §7.1]. Authored: choosing the
receipt instant. The reasons are internal and are the same two that decided §2: moving authority at
the release would grant it to a party that has not spoken (M1), and [A8 §7.4(b)] already holds that a
former holder _"never stops being authoritative for facts before the handoff"_. **Do not score on
this** until A8 ratifies it ([SD §4.7] note 3).

Everything else in [A8 §7] is unaffected in substance. [A8 §7.3] A8-JOINT is untouched — it names
`condition` _"and the counts asserted with it"_, and it is now visibly **not** a rule about handovers.
[A8 §7.6]'s conclusion is unchanged: A's late delivery assertion still loses, because the delivery's
instant still falls after the `349` boundary.

### 7.4 `handover`'s own authority row — and it may not be `boundBy = CUSTODY`

[SD §4.7.1] gives the `handover` row `boundBy = CUSTODY`. That is **circular**, and [SD §4.8.2] says
so about the identical shape when it rejects a `custody` fact class: _"that row's binding would be
`CUSTODY`, so **A8-MOVE would be defined in terms of the thing it defines**. The fold breaks the
circle — `handover`'s authority is decided on its own row."_ The two sentences contradict each other,
and F1's fix makes the contradiction load-bearing, because the fold now depends on selecting among
paired handover assertions.

**Edit:** the row's `boundBy` becomes **owed, expressly not `CUSTODY`**. Provisional **[ORIGINAL]**,
**do not score**: authority for a key belongs to the role named on that key's `side` — the releasing
role for `RELEASE`, the receiving role for `RECEIPT` — which is `src:stedi-x12-reference`'s own
arrangement (only the releasing carrier issues `J1`; only the receiving carrier issues `R1`) and which
breaks the circle because it reads the key, not the fold. Whether that is a sixth `boundBy` member or
`NONE` plus a named rule is [A8]'s to decide. **[A8 §5] owes a `handover` row** — it has none today
([SD §4.7.1]'s handover row cites §7.1 and §7.6 precisely because §5 has no row), and under **A8-NAMED**
every handover `FactResolved` must name a rule. **Recommend recording as F3.**

### 7.5 Everything else that reads handovers

- **[A3 §3.2]'s verb table** keeps its ruling (`transfer-out` and `transfer-in` are one type) and
  gains the qualifier that makes it work.
- **[A3 §8] scenario 8** is unchanged in outcome; its _"only one of the two handovers has been
  published"_ sentence stops being a stipulation and becomes C5.
- **[SD §8.2] `ExternallyPerformedLeg`** is unchanged: it still carries `custodyBasis` and
  `performedBy` as the fold's other input, and it can now carry the handover that opens it and the
  handover that closes it without collision — they differ in `side`.
- **[SD §4.6] E-CANON** is entirely unaffected; the family does not move.
- **[SD §5] M2** is unaffected: a handover is possession-changing, so it still needs a human or
  partner asserter and can never be `ASSUMED_FROM_PLAN`.
- **[SD §5.3] `storeIn` / `storeOut`** are **not** handover types and are not in the fold's inputs
  ([SD §4.8.3] rule 1). Whether a SIT handling-in also publishes a `handover` is untouched by this
  decision and is **not settled here**; it is adjacent, it is real, and it belongs with A5's storage
  boundary ([SD §10.4]).

---

## 8. Acceptance criteria — what must be true after the edits

Against `packages/domain-reference/alloy/custody.als`, with `Handover` given the qualifier and
`factKeyHasOneWinner` restated **per key** rather than per goods:

| Predicate                                             | Before  | After                                    |
| ----------------------------------------------------- | ------- | ---------------------------------------- |
| `foldsUntilFieldIsReachable`                          | UNSAT   | **SAT**                                  |
| `custodyChangesHandsUnderTheFactKey`                  | UNSAT   | **SAT**                                  |
| `custodyAtReturnsAtMostOneHolder`                     | counter | **no counterexample** (C6 empties a tie) |
| `custodyAtReturnsAtMostOneHolderUnderTheFactKey`      | counter | **no counterexample**                    |
| `unknownBeforeAnyHandover`, A5's last-writer-wins run | SAT     | **SAT** (unchanged)                      |
| a new run: `UNKNOWN` across a transfer gap (C5)       | —       | **SAT**                                  |

`F1` in [`findings-from-alloy.md`](findings-from-alloy.md) moves to `resolved` only when those hold.

---

## 9. The exact edits this implies

**[SD §4.7.1] — the `handover` row.** Replace the row with:

| `type`                             | family      | `qualifier`                                                                                                                                                                                                                             | `context[]` carries                                     | Authority · `boundBy`                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`handover`** _(custody handoff)_ | **`goods`** | **`{releasing, receiving, side, occurrence?}`** — `releasing`/`receiving` are members of the published role vocabulary ([A8 §2]); `side` ∈ `RELEASE` \| `RECEIPT`; `occurrence` is a 1-based ordinal, absent = 1 (H-OCCUR). See §4.7.2f | both `stop`s / `trip`s, or the `externallyPerformedLeg` | **The two sides assert two facts, not two sides of one** (§4.7.2f). Provisionally the role named on the key's `side` is authoritative for that key — **[ORIGINAL]**, do not score. `custodyBasis` 41 vs 349 decides whether authority moves. · `boundBy` **owed, expressly not `CUSTODY`** (circular — §4.8.2) · [A8 §7.1 A8-MOVE, §7.6; A8 §5 owes a row] |

Note the deletion: `partyRole` leaves the `context[]` column (two homes for one link is revision 3's
defect **C**, [SD §1.1]).

**[SD §4.7.1] — the act-family row.** Add, after the `arrival`/`departure` carve-out sentence: _"A
`handover` is a fact about the goods and stays in this family — the juncture is not its subject; see
§4.7.2f."_

**[SD §4.7.2] — add `(f)`,** carrying §2 (the two-facts verdict and its citations — as applied, four
of them: §2.1(b) is withdrawn and §2.1(f) is left here), §3 (Q-KEY),
§4 (the four candidates and why three lose), §5 (the components, their marks, H-OCCUR) and §6 R4 (the
two tests that separate this from (d)(3)). It must state in its own words that
**[SD §4.7.2d(3)]'s refusal stands** and that a `partyRole`-_reference_ qualifier would violate it.

**[SD §4.7.3] — the OPEN DEFECT F1 block.** Replace with: _"**F1 — closed at §4.7.2f.** `handover`
declares `{releasing, receiving, side, occurrence?}`; the two sides are two facts; §4.8.3's fold gains
rules C5 and C6. Recorded in [`findings-from-alloy.md`](findings-from-alloy.md) and in
[`F1-handover-qualifier-decision.md`](F1-handover-qualifier-decision.md)."_ Keep the paragraph's last
sentence's spirit: two **new** defects are opened in its place — the `context[]`-sourced receiving side
(F2, closed by the same edit) and `handover`'s circular `boundBy` plus the missing [A8 §5] row (F3,
open).

**[SD §4.8.3] — the fold.** Replace the code block with §7.1's, keep rules 1–4 verbatim, append C5 and
C6, and replace the `UNKNOWN`-reason enumeration. In the paragraph **"What this settles for
`boundBy = CUSTODY`"**, replace _"moving at a boundary per **A8-MOVE** on the selected handover's
`custodyBasis`"_ with _"moving at the selected `RECEIPT`'s `occurredAt` on that receipt's
`custodyBasis` (A8-MOVE as amended, §7.3 of the F1 decision)"_.

**[SD §4.8.2] — the "Not a fact class" bullet.** Its parenthetical _"(both sides assert, the `J1`/`R1`
pair)"_ now reads _"(both sides assert, and they assert two facts — §4.7.2f)"_, so the subsection's
own anti-circularity argument and §4.7.1's `boundBy` stop contradicting each other.

**[SD §1.3] item 3.** After the `identity` worked case, add `handover` as the second worked case of a
qualifier — one fact class covering several independently-contested facts about one subject.

**[SD §10.1] (`A3` conformance).** Add: A3 §3.2's `transfer-out`/`transfer-in` row keeps _"one
`handover` type … not two types"_ and must cite the qualifier; A3 §8's _"where only one of the two
handovers has been published"_ sentence is restated as a consequence of C5, not as a stipulation.

**[SD §10.3a] (`A8` conformance).** Add four items: (i) [A8 §5] owes a `handover` row; (ii) A8-MOVE is
amended to name the receipt instant (§7.3); (iii) [A8 §7.6]'s two handover records gain
`qualifier = {OriginAgent, Hauler, RELEASE|RECEIPT, —}` and a `FactResolved` each, and its `stop:X` on
two trips is corrected to two stops ([SD §8.1]); (iv) [A8 §9 item 9]'s _"§7.6 answers two"_ is upheld
and now has a mechanism — cite §4.7.2f.

**[`findings-from-alloy.md`](findings-from-alloy.md).** F1 → `decided, pending application`, pointing
here; add F2 and F3 per §7.2 and §7.4.

**Executable model** (`packages/domain-reference/`) — **all applied**:
`data/canonical-subjects.json` — the `handover` row's `qualifier` (fields, the `side` and
`occurrence` domains, the citation, the `[SYNTHESIS]`/`[ORIGINAL]` markers) and its `authority`
(`boundBy` → owed, `scoring` → `do-not-score`); `src/custody.ts` — retire
`HANDOVER_RECEIVING_SIDE` and `receivingSides`, read `value.receivingParty`, add the two `UNKNOWN`
reasons, implement C5's open/close sequence and C6's tie; `alloy/custody.als` — give `Handover` the
qualifier, restate `factKeyHasOneWinner` per key, add a C5 run (**and no `expect` change: an earlier
draft of this list said "flip B1/B3's `expect`", which was wrong. B1 and B3 already carried
`expect 1` before the fix — the pre-fix run reported them as _"got UNSAT, **expected SAT**"_, which is
what made them findings rather than passes. Nothing to flip. See `findings-from-alloy.md` F1's
pre-fix output note**);
`tests/scenarios/mid-journey-custody-handoff.test.ts` — two spans and a gap, not one span. Applied,
and with two additions beyond the list: `src/vocabulary.ts` and `src/assertions.ts` carry the
qualifier's shape and the `value` fields, and the fact key normalises an absent `occurrence` onto 1
so that H-OCCUR's two spellings pair rather than splitting one contest in two. A `custodyAuthorityAt`
function carries §7.3's amended A8-MOVE, kept **separate** from the fold because the fold is silent
across a C5 gap and authority is not.

---

## 10. What this forecloses

1. **A handover can never again be one record agreed by both parties.** Agreement is two records and
   a query. Nothing in the catalog will ever hold "the handover", and consumers that want one row get
   it from a downstream named rule, as [A8 §7.3] already requires for a joint `condition`.
2. **Custody can never move on one party's word.** A partner that emits only `J1`, or only `R1`,
   leaves permanent `UNKNOWN` spans. That is a real operational cost and it is the intended one
   ([SD §4.8.3] rule 3, M1), but it must be stated to ingest before it is discovered in production.
3. **`handoverOut` / `handoverIn` are foreclosed as type names**, permanently, and with them any read
   of the release/receipt distinction off the type. It lives in the qualifier or nowhere ([A3 §3.2]).
4. **The transfer's time can never be a key component** (Q-KEY(iii)), so a handover time stays
   contestable and correctable — and no future revision may reach for `{occurredAt}` to separate two
   transfers between the same pair. `occurrence` is that seat, and it is taken.
5. **No catalog-minted custody-transfer sequence number**, ever. The only ordinal in the model is
   party-asserted and bilateral.
6. **The juncture is foreclosed as a subject.** "What happened at this transfer point" is a
   `context[]` query, which [SD §1.4] makes non-authoritative and non-paired. If A5 or A3 later needs
   an authoritative juncture object, this decision will have to be reopened — that is the price of
   keeping the `goods` family and E-CANON untouched.
7. **`boundBy = CUSTODY` is foreclosed for `handover` itself**, so `handover` can never be folded
   into the class list [A8 §4.3] governs, and any future authority rule for it must be written without
   reference to the fold.
8. **`occurrence` may not be derived by the platform.** It is asserted or it is absent.

---

## 11. Marks index

**[ORIGINAL]:** Q-KEY (§3); the two R4 tests (§6); H-OCCUR and its integrity query (§5); the fold's
C5 and C6 (§7.1); the amendment naming the receipt instant in A8-MOVE (§7.3); the provisional
side-names-the-authority reading and the refusal of `boundBy = CUSTODY` for `handover` (§7.4); the
argument from two outcomes (§2.1e); the inference that "one type" + "two facts" has exactly one
solution (§5).

**[SYNTHESIS]:** `releasing`/`receiving` as key components — `src:open-trip-model`'s `HandOver`
`from`/`to` actor refs and `src:stedi-x12-reference` element 1650's counterparty-naming codes supply
the two ends; putting them in the key is the join.

**Sourced, quoted in place:** `src:stedi-x12-reference` element 1650 `J1`/`R1` and the stedi
analysis's "two complementary assertions by two different parties"; `src:uncefact-rec24` 41 / 349;
`src:open-trip-model` `HandOver`; `src:dp3-tender-of-service` §B.3.f; `src:sirva-ade`'s recording-only
clock and its role cast; `src:dp3-400ng` Item 125.

**Do not score above medium on:** the authority reading in §7.4, the A8-MOVE amendment in §7.3, and
anything downstream of them ([SD §4.7] note 3; [A8 §10]'s last row).
