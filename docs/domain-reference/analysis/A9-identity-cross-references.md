# A9 — Identity & cross-references

**The last of the nine v1 detail areas, and not the first to open with a piece of its own subject
already owed to it** — [A4]'s reason vocabulary and [A5]'s `Remedy` shape were both carried as owed
values naming their area, and **both areas published**, minting `publishedOwedVocabulary` and
`publishedOwedShape` to do it. **A9 is the one that declines**, and the contrast is the point.
`identityScheme` is one of the three owed closed vocabularies, it is A9's, and [A6 §3.2(a)] had
already specified one bit each of its members must carry. So A9 did not have to argue that it owns
something. It had to decide whether it can **publish** it.

**It cannot, and the reason is what the corpus publishes rather than what it omits.** §3.2 is the
round's central decision and §3.6 is its structural finding.

Written under [SD §0]'s disclosure rule: every claim below cites a source that says **that** thing,
or is marked **[ORIGINAL]** / **[SYNTHESIS]** at the point of use. Sources are cited `src:<id>` per
`sources/registry.yaml`, and **primary** means quoted from captured material held in this repo while
**secondary** means quoted from that source's own `analysis.md` — [A6 §2] and [A7 §2]'s convention,
kept.

---

## 1. What was owed to A9, audited against the code and the binding text

[A7 §1] is the model for this section and its instruction is the one worth repeating: **audit what a
plan says is owed before designing around it.** Four rounds had found a plan wrong about its own
premises before A7; this is the fifth, and three of the five findings below are corrections to the
plan A9 was working from.

### 1.1 The nine inbound hand-offs, and how each closed

| #   | Owed by                                                                  | Settled                                                                                                                                                      |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | [A6 §Cross-area] to [A9]; [A6 §3.2(a)]; a comment in a passing assertion | **I-ACCOUNT** (§3.4) — the bit is supplied as a **partial function**, because §3.2 refuses the vocabulary the bit was going to be a column of                |
| 2   | [A1 §Cross-area] to [A9]                                                 | **Not collapsed** (§3.4, §3.3's `shipmentConfirmationNumber` row) — the acceptance survives as its own scheme, and its subject is an **act** the model lacks |
| 3   | [A2 §Cross-area] to [A9]                                                 | **Recorded, not modelled** (§3.5) — `CamisRegNumber` encodes structure; `fork-order` §3.6 already rejected that as _the_ shape and A9 does not revisit it    |
| 4   | [A5 §Cross-area] to [A9]                                                 | **Already expressible** (§3.5) — the `ltsRequestNumber` ↔ `hhgRequestNumber` back-reference is an identity assertion, and A5's refusal to link stands        |
| 5   | [A3 §Cross-area]'s A9 bullet                                             | **Discharged before A9 opened** — [SD §7.4] states so in as many words; §3.3's `equipmentNumber` row carries the evidence                                    |
| 6   | `round-1-crosscheck.md` §A9's "pick one shape"                           | **Discharged by [SD §7.1]** — §1.2 finding 1, and it is [A2 §1]'s already-applied-backlog shape again                                                        |
| 7   | [A2 §3.6]'s instruction to A6, A7 **and A9**                             | **Answered, and the answer is a split** (§3.7) — assignment and reissue are expressible; the acts the model cannot record reduce to A6's and A8's            |
| 8   | The rubric's A9 `Covers` row                                             | **A prompt, not an inventory** (§3.8) — one of the corpus's three routing hints, and the residue runs both ways                                              |
| 9   | `identityScheme` on the glossary's Owed page                             | **Left owed, deliberately** (§3.2), and the refusal is held by the compiler rather than by this sentence                                                     |

### 1.2 Five audit findings — three corrections, one confirmation, one addition

**1. `round-1-crosscheck.md` §A9's recommendation was already discharged, and by the shared layer.**
The crosscheck tells phase 3 to _"pick one shape (`src:dcsa`'s three slots, or `src:project44`'s
typed 70-value list) and move on."_ [SD §7.1] picked: an identifier is an Assertion of
`type = identity` carrying `{scheme, vocabularyScope}` as its qualifier and `{id, issuer,
effectiveFrom, effectiveTo?}` as its value, and **I-KEY** fixes the fact key. That is `src:dcsa`'s
subject slot and `src:project44`'s assigner-typed enum resolved into one shape, and it was settled
before A9 opened. **A9 supplies the terms and never the shape.** It is the same shape as [A2 §1]'s
already-applied backlog — a plan hands forward a list of work that a later document has silently
done — and it is the **fifth** round to find its own plan wrong about what was owed, after [A4]'s
blind owed ledger, [A2]'s seventeen-item backlog, [A6]'s owed item 6 and [A7]'s three.

**2. The plan's grep instruction was right, and it was right because the plan's own list is short by
three.** `plans/in-progress/domain-reference-areas-a9.md` §6 item 2 says _"grep for them, do not
trust this list"_ and then names [A6 §Cross-area], [A1 §Cross-area] and [SD §7]'s I-KEY — of which
the third is A9's floor rather than a hand-off. The greps turn up three more `To [A9]`-shaped
hand-offs it does not name: **[A2 §Cross-area], [A5 §Cross-area] and [A3 §Cross-area]'s A9 bullet**,
all three written by areas that closed after the plan's own predecessor, which is why they are the
ones missed. The code greps turn up six more — `src/identity.ts`'s `TODO(A9)`, two in
`src/rules/documents.ts`, `data/canonical-subjects.json`'s `identity` `contextNote`, and two test
comments, **both inside passing assertions**. **This is [A7 §1] finding 3's shape exactly**, and the
difference is worth recording: A7's plan asserted a complete list, A9's told the reader not to trust
it. The instruction is the fix, and it worked.

**3. `areas:` in `sources/registry.yaml` is a prompt, not an inventory — and it is systemic, not
A9's.** `src:dtr-part-iv` scores A9 `3 / 3 / n-a / 3 / n-a / 3 / 3 / 1`, its analysis opens the
row with _"The strongest area"_, and its `areas:` list does not contain A9. So do
`src:samsara` (whose A9 row reads _"Best-in-class, and the specific thing to adopt"_),
`src:dp3-400ng`, `src:dp3-tender-of-service`, `src:cfr-49-375`, `src:shippeo` and others.
**A9's first instinct was to fix the entries, and measuring first is what stopped it:** the same
mismatch exists for **every one of the thirteen areas**, A2 more than A9. `areas:` was written
during the 2026-09-11 research passes, before any source was analysed, and the registry's own header
says so. It is a discovery hint that got read as a routing table.

So A9 makes **one** edit to the registry — a sentence in the schema comment saying what the field
is — and fixes no entry, because repairing fourteen of a hundred-odd pairs would make the field look
like an inventory precisely where it is not one.

> **AMENDED by the cleanup round's B1, which is the curation this finding recommended.** Everything
> above was true when it was written and half of it is now false, so it is amended rather than left
> standing — which is what this document's own tamper list (§9.2 item 8) said must happen on the day
> the registry was curated.
>
> The user's decision was **recompute and gate**, and it turned out to be a **hybrid**: only the
> sources that have a score table can have `areas:` generated from one. For those it is now exactly
> the areas their analysis scores non-zero, held per source by a conformance test that names any
> entry that drifts. For every other entry — the ones with no analysis to generate from — `areas:`
> stays the hand-written discovery hint this finding describes, because it is the only signal there
> is for them and regenerating it would delete information rather than correct it. The registry's
> schema comment now states both rules and says the split is on the presence of a score table and
> never on `status:`.
>
> **Two things B1 measured that change how this finding reads.** First, the mismatch was not
> partial: **every** source with a score table had at least one area it scored and did not declare,
> so "fourteen" above was A9's instinct about its own area rather than the size of the gap. Second,
> the field did not only under-claim — several entries **declared areas their analyses never scored
> at all**, `src:atlas-world-group-api` naming three such areas with no rows behind them. A field
> that was wrong in both directions is a stronger argument for generating it than this finding knew.
>
> Still not written here: the sizes. [A1 §9]'s rule holds, and B1's gate **enumerates per source**
> rather than counting, so a number in this paragraph would be the one thing nothing checks.

> **The count is measured and deliberately not written into this document.** [A1 §9]'s rule is that
> a count in prose is gated or deleted, and a gate over this one would fail the day somebody curates
> the registry — which is the outcome this finding recommends. `tests/conformance/source-registry.test.ts`
> gates the two things that must stay true instead: the `src:dtr-part-iv` instance the paragraph
> above leans on, and that **every source A9 cites carries a scored A9 row**.

**4. The plan's captures list is right, and saying so is worth a line.** It names eight sources with
a `captured/` directory — `atlas-world-group-api`, `cfr-49-375`, `dcsa`, `gs1-epcis-cbv`, `gtfs`,
`milmove-docs`, `milmove-mymove`, `x12-212-trailer-manifest` — and `ls -d sources/*/captured` returns
exactly those eight. Four rounds of plan audits have produced corrections; this one produced a
confirmation, and an audit that only ever reports errors is not measuring the plan, it is filtering
it.

**5. A9 inherits `charge`'s provisioning problem inverted, and the plan got this half right.**
[A7 §1] found the previous plan had understated what A7 inherited. A9's plan overstates nothing, but
it does miss the consequence that matters: **`identity` is the best-provisioned subject any area has
inherited.** It is a declared `type` ([SD §4.7.1]) with a declared qualifier ([SD §1.3]), a
`family` of `anyAggregate`, an **assigned** authority row (`boundBy = SCHEME`, [A8 §5] row 10), a
settled fact key (**I-KEY**), a settled correction path (`supersedes`, [SD §7.5]) and a settled
resolution rule (`primary` by `FactResolved`). Everything A2, A6 and A7 found missing for their own
subjects is present here. **What A9 lacks is not machinery. It is terms** — and §3.2 is about why
the corpus does not supply them in the form the model asked for.

---

## 2. The sources, and what each is good for

**A9 is the best-covered area in the corpus and the coverage is lopsided in a way that decides the
round.** `round-1-crosscheck.md` §A9 calls it _"well-covered… bordering on over-covered — five
sources independently converge on the same shape"_, and that is true **of the shape**. It is not true
of the terms.

### 2.1 The split that decides §3.2

Most of the source analyses carrying a scored A9 row score `C6 = 3` on it (_"multiple party
references, typed, with correlation"_), and **A9's share of `C6 = 3` is the highest of the thirteen
areas by a wide margin** — measured, and gated in `source-registry.test.ts` rather than written as
a number here. But `C4` (**HHG fidelity**) splits them hard, and several sources say so in their own
words:

- `src:samsara`, `C6 = 3` / `C4 = 0`: `externalIds` as an org-scoped key→value map addressable in a
  path as `key:value`, _"Best-in-class, and the specific thing to adopt"_ — and then, in the same
  row, **_"C4=0: no HHG identifier vocabulary (registration no., SCAC, BOL/PRO, service order no.) —
  the mechanism is there, the terms are not."_** Secondary.
- `src:project44`, `C6 = 3` / `C4 = 1`: a 70-value `LogisticsIdentifierTypeEnum` whose own
  definition is _"the standard which defines **who assigns** the identifier and **what it
  identifies**"_ — the single best sentence about identity in the corpus — and _"`PRO`,
  `BILL_OF_LADING`, `CARRIER_SCAC` are present but there is no registration number, service-order
  number or van-line order number."_ Secondary.
- `src:open-trip-model`, `C6 = 3` / `C4 = 0`; `src:omnitracs-roadnet`, `C6 = 3` / `C4 = 0`;
  `src:gs1-epcis-cbv`, `C6 = 3` / `C4 = 0`; `src:alvys-api`, `C6 = 3` / `C4 = 0` — _"the best A9 in
  the comparator set"_, and no HHG term in it.

Against them, the sources that carry the terms are the regulatory and DoD material and the two
partner contracts — and they are the ones with the weaker mechanisms and, mostly, no captures.
**§3.3's table is built from the second group and §3.2's refusal is argued from the first.**

### 2.2 Primary and secondary, per source A9 actually cites

Thirteen sources supply a witness to §3.3's table. Marked as [A6 §2] and [A7 §2] mark them:

| Source                             | Grade available | What it supplies                                                                                       |
| ---------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| `src:cfr-49-375`                   | **primary**     | The BOL's issuance and number, the carrier-assigned shipment registration, USDOT/MC, per-article ids   |
| `src:milmove-mymove`               | **primary**     | `serviceOrderNumber` and the order-identifier family — see the warning below                           |
| `src:atlas-world-group-api`        | secondary       | `ord_number` beside the surrogate `ord_hdrnumber`; the typed `ReferenceNumber`; `ApplicationXRefModel` |
| `src:x12-212-trailer-manifest`     | secondary       | `MS2`'s owner-scoped equipment identity; `BLR`'s time-scoped carrier attribution; `M7` seal numbers    |
| `src:dtr-part-iv`                  | secondary       | Ten-plus typed identifier families, three of them **constructed**; accountable BL stock                |
| `src:dp3-400ng`                    | secondary       | GBLOC and its dated reassignment; SCAC; the BL number                                                  |
| `src:dp3-tender-of-service`        | secondary       | SIT control number, DD 1164, CAGE, US DOT of the actual hauler, seal-to-container cross-reference      |
| `src:nmfta-ebol`                   | secondary       | The PRO as the document's own key; the acceptance identifier; the open `additionalReferences[]` slot   |
| `src:stedi-x12-reference`          | secondary       | `B10`'s four identifiers side by side, each labelled by assigner                                       |
| `src:x12-858-implementation-guide` | secondary       | `BX04`'s assigner + scope + immutability in one sentence; `ZZ` as the documented private extension     |
| `src:sirva-ade`                    | secondary       | The `Brand + RegNumber + RegYear` triple; `CamisRegNumber`; two trip schemes; the agent code           |
| `src:weichert-supplier-api`        | secondary       | Seven typed prefixed id classes; both-sides-keep-their-own-key; and a stated **absence**               |
| `src:project44`                    | secondary       | The assigner-typed enum, and the documented escape hatches                                             |

> **A capture proves a field exists and often defines nothing, and A9 has a clean instance of it.**
> `src:milmove-mymove`'s `serviceOrderNumber` is in the captured swagger as a bare string with
> `x-nullable: true` and **no description**
> (`captured/swagger-def/definitions/MTOShipment.yaml`). Its reading as _"the counterparty's
> identifier carried on our record"_ is the analysis's, from `mto_shipments.go:158`. So `primary`
> is a statement about **provenance, not about semantic strength** — which is the rubric's own
> scoring rule read in the direction nobody reads it in: _"evidence grade caps confidence"_ caps a
> secondary reading, and a primary capture of an undocumented field supports `C1` and nothing more.

### 2.3 Two sources named as A9's best that A9 cannot and does not cite

`round-1-crosscheck.md` §A9's "strong sources" list includes `src:pegasus-integration-floors`, and
its body names `src:pegasus-cloud-prisma`'s `IntegrationCorrelation` as _"the right shape at the
wrong arity"_. Both are `role: mapping-only` in the registry: they are **not evidence for what the
domain is** ([SD §0], and the rubric's scope rule in as many words). The observation about
`IntegrationCorrelation`'s arity is correct and belongs to a mapping exercise that has not been
authorised; it appears nowhere in §3.

**Checked per source rather than trusted from a list**, because [A7 §1] found the previous plan had
made the opposite error — calling `src:sirva-ade` one of ours when the registry says
`role: model-evidence`. `src:sirva-ade` and `src:atlas-world-group-api` and
`src:weichert-supplier-api` are partner contracts and are cited freely below;
`tests/conformance/source-registry.test.ts` holds the check against the registry so that it cannot
rot.

---

## 3. Decisions

### 3.1 The shape is [SD §7]'s, and A9 does not reopen it

**Decision. [SD §7]'s identifier shape, I-KEY, the `issuer` / `authority` split, the effective
interval, `primary`-by-resolution and canonicalise-to-match are A9's floor and not A9's question.
A9 supplies the terms.**

This is stated as a decision rather than assumed because the crosscheck's recommendation
(§1.2 finding 1) invites exactly the opposite reading, and because three of A9's inbound hand-offs
([A3]'s, [A5]'s, and half of [A2]'s) were **already discharged by [SD §7]** and would be
re-litigated by an area that read "pick one shape" as an instruction.

Two things §3.3's table adds to [SD §7] without changing it, both of which strengthen it:

- **The `issuer` / `authority` split has a second witness.** [SD §7.1] argues it from `MS2` alone —
  equipment identity is the owner's SCAC plus the number _that owner_ assigned. §3.3 finds the same
  structure in an unrelated regime: `src:nmfta-ebol`'s PRO is drawn by the **shipper** from a block
  the **carrier** issued, _"pre-assigned by the shipper from a carrier-issued block, or
  auto-assigned by the carrier if absent"_ (`:257`–`:261`, secondary). The assigning party and the
  vocabulary's owner are routinely different parties in freight, and one witness had made that look
  like an equipment quirk.
- **Three of the twenty schemes are _constructed_**, in the sense that positions of the value carry
  meaning: the SIT control number (`YY` + Julian day + intra-day sequence, [SD §7.4]), the TCN
  (position 15 typed by shipment kind), and the van-line registration triple. [SD §7.5]'s
  _"canonicalise to match; never to store"_ is what makes that safe, and it is worth noticing that
  the policy was adopted for a different reason (`src:shippeo`'s Smart Reference Matching) and turns
  out to be load-bearing for a case nobody had it in mind for. A canonicaliser that stripped leading
  zeros **in storage** would destroy a Julian day.

### 3.2 `identityScheme` is not closable, and the corpus refuses the dichotomy — the central decision

**Decision. A9 declines to publish `identityScheme` as a closed vocabulary. `SchemeName` stays
`OwedCode<'identityScheme'>`, the refusal is held by `IdentitySchemeStaysOwed` in
`src/rules/identity-schemes.ts`, and what A9 publishes instead is §3.3's witnessed-scheme table and
§3.4's rule over it.**

Publishing an owed vocabulary is a known, classified, version-moving act — `publishedOwedVocabulary`
at [catalog §2.3], first used by [A4 §3] for the reason vocabulary. A9 is the area that was
**expected** to use it. It does not, and the argument is not that the work is unfinished.

#### (a) Every source that publishes a closed identifier list publishes an open slot beside it

Five, in five regimes, and none of them treats this as a compromise:

| Source                             | The closed list                                        | The open slot beside it                                                                                   |
| ---------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `src:project44`                    | 70-value `LogisticsIdentifierTypeEnum`, assigner-typed | `EXTERNAL` / `REFERENCE_NUMBER` / `CUSTOMER_REFERENCE`, _"the documented escape hatches"_                 |
| `src:nmfta-ebol`                   | ten positionally-typed reference kinds                 | `additionalReferences[] {name, value}` — _"one open `{name, value}` escape hatch"_                        |
| `src:x12-858-implementation-guide` | `REF` / `N9` qualifier codes                           | `ZZ` _"Mutually Defined"_, _"the standard's own documented private-extension mechanism"_                  |
| `src:stedi-x12-reference`          | `B10`'s four labelled slots                            | `L11` at a header max use of **300**, _"a qualified, repeatable home rather than a bag of custom fields"_ |
| `src:open-trip-model`              | a 34-value `entityType` enum on `reference`            | `externalAttributes`, _"for additional meta data and/or additional ID's of an entity"_                    |

All secondary. A sixth source, `src:samsara`, ships **only** the open form — `externalIds` as an
unbounded, customer-defined, org-scoped map, addressable in a URL path — and its analysis scores
`C8 = 3` for it.

#### (b) Two of the five publish a warning against their own hatch, which is the part that decides it

`src:open-trip-model`'s specification, quoted in its analysis: **_"Please, use this with caution:
having too many external attributes can be a sign of not using OpenTripModel as it was intended."_**
And `src:project44`'s analysis, of the same shape one vendor over: _"The escape hatch exists but
carries no semantics — the same gravity well as OTM's `externalAttributes`."_

So the corpus does not merely fail to close the vocabulary. **It has considered closing it, declined,
and documented the cost of the decline.** A closed-versus-open choice is a dichotomy the sources
already refused, and an enum admitting only the twenty schemes §3.3 can cite would be **less**
faithful to them than the `OwedCode` the model ships today.

#### (c) And the lists that do exist disagree about what kind of thing they are

Publishing one would require choosing, and the choice is not between vocabularies — it is between
**taxonomies of different things**:

- `src:project44`'s 70 values type the identifier by _who assigns it and what it identifies_,
  deliberately spanning documents, parties, equipment, devices and people.
- `src:nmfta-ebol`'s ten are **field names**: the type is the position, not a code.
- X12's are qualifier codes drawn from a shared registry and reused across transaction sets.
- `src:dtr-part-iv`'s are named **families** with construction rules, not a list at all.
- `src:uncefact-mmt-rdm` and `src:uncefact-scrdm` ship an 817-value `ReferenceTypeCode` list that
  is, in both analyses' own words, a bare `xsd:enumeration` **with no names and no definitions** —
  which `round-1-crosscheck.md` flags as precisely the trap: _"a phase-3 area file that says
  'UN/CEFACT gives us a party-role vocabulary' would be false — it gives us a mechanism and a
  count."_ A9 does not make that claim, and the 817 values are not evidence for a scheme list.

#### (d) What the refusal costs, stated rather than absorbed

It costs the thing A6 asked for, unless something replaces it — and §3.3 and §3.4 are that
replacement. It also costs the model a version bump it might have had: nothing published moves
(§9), so A9 joins [A2] and [A6] as a round whose decisions change no byte on the wire. **That is a
weaker outcome than [A4]'s and A9 says so.** A4 closed a gap; A9 argues a gap should stay open. The
argument is falsifiable in one move — a source that publishes a closed HHG identifier-scheme list
with no escape hatch would overturn it — and `IdentitySchemeStaysOwed` exists so that overturning it
cannot happen silently.

> **The gate, and why it is not [A2 §9]'s tautology.** `IdentitySchemeStaysOwed` is
> `Exact<SchemeName, OwedCode<'identityScheme'>>` with its assignment beside it — [A5 §9]'s finding
> applied for the fifth time. The two sides are declared **independently**: `SchemeName` in
> `src/identity.ts`, from [SD §7.1]; the right-hand side written out in A9's own module from this
> section's reading. `data/identity-schemes.json` is deliberately **not** in the comparison, because
> the table is a catalogue of witnesses and putting it there would assert the closure this section
> declines. Tampered and watched to fail — §9.

### 3.3 The witnessed-scheme table — what A9 publishes instead

**Decision. A9 publishes a catalogue of the identity schemes the external corpus witnesses, at
`data/identity-schemes.json`, carrying per scheme: what it identifies, its vocabulary authority,
whether the issuer is that authority, whether the corpus defines it or only names it,
[A6 §3.2(a)]'s document-accountable bit, its blocker if it has one, and every witness with its
grade. Twenty schemes, thirteen sources. It is not a vocabulary and the loader does not treat it as
one.**

The full table is the data file; it is not reproduced here, because a table in two places is a table
that drifts ([A7 §4] item 9's lesson in the other direction). What belongs here is what reading it
as a **set** produces.

#### (a) Rows are `(scheme, authority)`, not scheme names — and three of the rubric's five names split

[SD §7.1] makes the fact key `(subject, scheme, vocabularyScope)` and `vocabularyScope.authority`
_"the body that defines and maintains the naming vocabulary"_. **A bare scheme name is therefore not
a naming system**, and the table's grain follows the key rather than the vocabulary:

- **"BOL/PRO"** is three rows. The carrier's bill of lading number (`src:cfr-49-375` §375.505(a),
  primary), the Government's (`src:dtr-part-iv` A-413 §C.2's accountable stock, secondary), and the
  PRO (`src:nmfta-ebol`, secondary). [A6 §3.3] already supplies the reason the first two are not one
  row: §375.103 defines a `Government bill of lading shipper` separately from a commercial shipper
  _"precisely because the carrier's BL and the GBL are two instruments, each issued by the party
  whose instrument it is."_
- **"registration no."** is two rows with different authorities, and §3.8 is about them.
- **"order no."** is one row with **three** witnessed authorities — the van line's
  (`src:atlas-world-group-api`'s `ord_number`), the RMC's (`src:weichert-supplier-api`'s
  `moveNumber`), the Government's (`src:milmove-mymove`'s `locator`) — and **no source defines what
  makes one order one order**. That question is [A1]'s and [A1] answered it without minting an
  identifier, so the row records the disagreement and claims nothing.

#### (b) The corpus **names** six of the twenty and **defines** neither more nor fewer

`definedNotMerelyNamed` is false for `orderNumber`, `scac`, `usDotNumber`, `mcNumber`, `tripNumber`
and `sealNumber` — enumerated in `identity-schemes.test.ts` rather than counted here. The worst case
is the best-witnessed one and §3.6 is about it. The general shape is the C1/C2 gap the rubric's own
scoring rules anticipate: **a code every party uses and nobody in this corpus defines.**

#### (c) Three schemes are document-accountable and it is a third answer to A6's question

[A6 §3.2(b)] ran D-ID over six **document kinds** and found _"one verdict of `DOCUMENT`, and it is
the same kind twice."_ A9 runs the same question over **schemes** and gets `bolCarrier`,
`bolGovernment` and **`pro`** — the third being new, because `src:nmfta-ebol` makes the PRO _"the
document identity, in the URL"_ rather than a field to be searched on, with a check digit and a
print form treated as the same fact. A6's finding is unchanged (the PRO is not one of the six
document kinds it enumerated); what A9 adds is that accountability is a property of the **scheme**
and can therefore be witnessed where the document kind was not.

### 3.4 I-ACCOUNT — [A6 §3.2(a)]'s input, as a partial function

> **Rule I-ACCOUNT.** Whether a scheme is document-accountable is a property of the scheme, and A9
> answers it for the schemes the external corpus witnesses and for no others. The answer is a
> **partial function**, never a default.

[A6 §3.2(a)] states the requirement precisely, and the shape it asks for is B-ONWARD's:
`documentIdentitySubject` takes the discriminant as a parameter and returns `undetermined` when it
is unknown, _"because the rule is decidable, its input is not published, and a default would be a
guess in the one place [SD §0] forbids one."_ A9 makes the input **available** where it can cite it.

**Three things the rule is not**, and each is a place a simpler design would have been wrong:

1. **It is not the vocabulary through the back door.** A scheme outside the table answers
   `SCHEME_NOT_WITNESSED` — a statement about the corpus, not about the scheme's legality. A rule
   that treated absence as a verdict would smuggle §3.2's refused closure back in via the rule.
2. **It does not re-answer D-ID.** D-ID chooses a **subject**; I-ACCOUNT supplies the bit it chooses
   on. [A6 §3.2(c)]'s boundary sentence stands unchanged: _"A6 owns the difference between a
   document's own fact and a fact it carries; A9 owns the scheme list."_
3. **It says nothing about whether the assertion can be made.** Five rows answer
   `documentAccountable: false` correctly and uselessly, because they have no subject at all —
   §3.6. `schemeBlocker` is that question and it is kept separate on purpose: **a scheme can be
   perfectly determined and still be unassertable**, and folding the two would hide exactly the
   finding this round is built on.

**Two `undetermined` reasons, because they fail for opposite causes.** `SCHEME_NOT_WITNESSED` is the
ordinary path and always will be (§3.2). `SCHEME_WITNESSED_BIT_NOT_PUBLISHED` is a **finding**, and
there is exactly one instance: **`shipmentConfirmationNumber`**, `src:nmfta-ebol`'s _"Number provided
by the carrier to acknowledge they accepted the BOL"_, which [A6 §Cross-area] calls _"the model case
of a scheme over the **lodging** rather than over the document"_. Its bit is unsettled because the
subject the source names is an **act of accepting**, and [SD §1.2] has no aggregate for one. Its
`identifies` is recorded as `document` because the number rides on the BOL and that is the only
subject in the model the sentence can attach to — and the note says so, rather than letting the
column imply the question is closed.

This is also where [A1 §Cross-area]'s instruction is honoured. A1 asked that the **award** and the
**acceptance**, separately dated in `src:stedi-x12-reference`'s `B1-03` and in
`src:atlas-world-group-api`'s `quoteNumber` / `ord_fromorder` beside `ord_number`, _"not be
collapsed"_. They are not: the acceptance survives as its own scheme with its own row rather than as
a second value under `bolCarrier` or a date on the order.

**`schemeAccountabilityForDId` collapses the two reasons on the way into D-ID, deliberately.** From
D-ID's chair a scheme nobody witnesses and a scheme whose bit nobody settles are the same unanswered
question, and its single `SCHEME_ACCOUNTABILITY_NOT_PUBLISHED` is right for both. **D-ID's
`undetermined` branch is not removed and cannot be** — §3.2 guarantees it stays reachable forever,
because while `identityScheme` is open a scheme outside the table is always possible. A9 narrows how
often the branch is taken and removes no branch.

### 3.5 A correlation is an obligation, not a link

**Decision. A9 adds no correlation field, no link table and no binding record. Two identifiers of one
subject are two assertions; a correlation between them is either already expressible under
[SD §7.5] or is an obligation the corpus states on a document, and A9 records which.**

The model's machinery is already complete here and [SD §7.5] wrote it: arity is N per I-KEY so two
schemes are two contests and not a conflict; `primary` resolves per tuple; a canonical match _"is an
Assertion with a resolvable verdict, never a truth"_; and the counterparty's key is echoed back
rather than mapped. What A9 adds is a reading of how the corpus actually publishes correlation, and
**it never publishes it as a field**:

- **An obligation to echo.** `src:dcsa`: references are provided by the shipper at booking and
  _"carriers share it back when providing track and trace event updates"_ (secondary, already in
  [SD §7.5]).
- **An obligation to print.** `src:dtr-part-iv`: the NTS lot number and service order number are
  printed into the BL's **block 19**; a consolidated BL lists its sibling BL numbers in **block 27**
  (secondary).
- **An obligation to annotate.** `src:dp3-tender-of-service` HHG §C.11.i: seal numbers are
  _"annotated on the inventory cross-referencing the container number"_ (secondary).

Three regimes, three obligations, no link. The four inbound hand-offs on this subject close against
it:

- **[A2 §Cross-area]** — `src:sirva-ade`'s `CamisRegNumber` (6 digits of shipment, 2 of overflow
  sequence, 2 of transfer sequence) is an identifier that **encodes structure**, and
  [`fork-order` §3.6] already rejected it as _the_ shape. A9 does not revisit that; it records the
  value as one row and reads its positions as evidence about the scheme, never as a fact about the
  shipment. The same discipline applies to the TCN's position 15.
- **[A5 §Cross-area]** — `src:weichert-supplier-api`'s `ltsRequestNumber` carried with
  `hhgRequestNumber` as a back-reference across the permanent-storage boundary is **already
  expressible**: an identity assertion whose subject is one order and whose scheme is the other
  programme's, carrying no claim that the two orders are one thing. [A5 §3.4(c)]'s refusal to model
  the boundary stands and A9 does not widen it.
- **[A3 §Cross-area]** and **[SD §7.4]** — already discharged, and [A3] says so itself. (The bullet
  is in A3's _"Cross-area consequences to record"_ section and **not** in its §8, which is the nine
  acceptance scenarios that the rest of the corpus cites as `[A3 §8]` — a near-miss worth naming,
  because every other citation of A3 in this model points at §8.)

**Recorded as a plain `= true` (`CORRELATION_IS_AN_OBLIGATION_NOT_A_LINK`) and not as a gate**, on
[A6 §9]'s distinction rather than a copy of its pattern: the rule is _"gate a recorded gap when the
gap has an edge the types can see, and say why when it does not."_ This claim becomes false only if
a later round adds a correlation **field**, which touches [SD §7], the envelope and both emitted
schemas — nothing in A9's module moves when that happens, so a typed assertion here would be a
decoration. `IdentitySchemeStaysOwed` one screen up is the contrasting case, and the two shipping
side by side is the point — as [A6 §9] and [A7 §9] each shipped both halves.

### 3.6 The best-witnessed scheme in the corpus has no subject — the structural finding

**Decision. Five of the twenty schemes identify a **party**; [SD §1.2] has no party aggregate, so an
assertion under any of them has no `subject`. A9 mints nothing, records no new owed item, and names
[A8 §9 item 1] as the blocker — because [A8 §9 item 1] already owes the party entity and already
names these very identifiers among its fields.**

[A2 §3.6] instructed A6, A7 **and A9** each to run the same check on its own aggregate. The three
prior answers were all different — A2 found no act and a `boundBy` gap, A6 found no act and an
answerable authority, A7 found no act and a missing **subject**. A9's is a **split**, and §3.7 is
the split. This section is the half that lands on the ledger.

**The five are `scac`, `usDotNumber`, `mcNumber`, `gbloc` and `agentCode`** — enumerated in
`identity-schemes.test.ts` by name, and enforced at load: `loadIdentitySchemes` refuses a `party`
row with no blocker and refuses [A8 §9 item 1] written onto an aggregate-grain row.

**And the worst-affected is the best-evidenced.** `scac` carries six witness rows — the most of any
row in the table — from `src:dtr-part-iv`, `src:dp3-400ng`, `src:stedi-x12-reference`,
`src:x12-212-trailer-manifest`, `src:nmfta-ebol` and `src:project44`. **Six rows, four publishing
bodies**: the DoD twice, X12 twice (`stedi` and the 212 are two readings of the same standard),
NMFTA and project44. The model cannot express a single one of those statements as an assertion,
because what a SCAC identifies is a company.

Three things follow, and the third is the decision:

1. **`ids.ts` already said so.** `PartyId` is documented as _"an identifier with no aggregate behind
   it"_, with a live `TODO(A8 §9 item 1)` asking whether the party becomes a fifteenth aggregate
   kind or stays outside the subject enum. A9 does not answer that question; it is A8's, and the
   answer decides whether these five rows' blockers come off or their schemes move to a different
   grain.
2. **`partyRole` is the near miss, and it is the wrong answer.** [SD §1.2] does carry a
   party-**role**, and [SD §1.1] _"puts the role on the assertion rather than on the party"_. A SCAC
   is not a fact about a role: it belongs to the company whatever it is doing on this shipment.
   Filing it against `partyRole` would key it on a tuple it does not vary with, which is why
   `identity-scheme-refuses.ts` puts `partyRole` **beside** the refusal as a legal neighbour rather
   than leaving it unmentioned.
3. **A9 mints nothing, and that is a decision.** [A7 §3.2] is the precedent in shape — a question
   that never reaches [A8 §9 item 8]'s ledger because the subject is missing — with one difference
   that changes what to do about it. **A7's missing subject was nobody's**, so A7 had to argue from
   the invoice-grain disagreement why minting was wrong. **A9's is already owed by name**, listing
   _"legal name, DOT/MC number, SCAC (`src:dtr-part-iv` #665), agent code, the branch grain…"_.
   Recording it again as A9's own owed item would **double-count a single gap** — [A7 §6]'s warning
   one level out: an owed inventory is a set of claims like any other and is auditable like any
   other. So the five rows name the existing item, and A9's §6 adds nothing to the ledger.

**One cost this imposes on the shared layer, recorded and not acted on.** [SD §7.2] sources the
identifier's **effective interval** twice, and the second of its two witnesses is
`src:dp3-400ng`'s GBLOC — _"responsibility can be reassigned mid-life, with a transfer list and
effective dates"_. GBLOC is one of the five. So the shared layer's second independent witness for a
load-bearing field is a scheme whose subject the model cannot express. **Nothing here reopens
[SD §7.2]**: the interval is right, the first witness (`src:x12-212-trailer-manifest`'s `BLR-02`) is
a shipment-grain attribution the model expresses perfectly, and the evidence stands. What is
recorded is that the worked example a reader will reach for is one A9 cannot write down.

### 3.7 [A2 §3.6]'s check, and A9's answer is a split

**Decision. Assignment and reissue of an identifier are expressible today. The acts the model cannot
record are not A9's to mint: one reduces to [A6]'s `documentIssuance` and the rest to [A8 §9
item 1].**

> **The first of those two reductions has paid out.** `documentIssuance` minted on 2026-10-05
> ([`A8` §5](A8-authority-skeleton.md) row 17), so the void / lost / stolen BL-number case §3.7
> reduced to A6 is now expressible as an act on a `document` rather than owed. The second reduction
> stands: [A8 §9 item 1] still owes the party entity, so §3.6's five party-grain schemes still have
> no subject. **Reducing rather than minting is what made this cheap** — A9 wrote no act, and the
> case closed when its owner closed.

Run the check as [A2 §3.6] wrote it — _does any act performed **on** this aggregate have a record?_
— and the answer separates:

- **Assign.** The identity Assertion **is** the assignment. This is not a fourth answer to A2's
  question and A9 declines the superlative it invites: A2's, A6's and A7's subjects were things
  _about which_ acts are performed, and an identifier is the assertion itself, so "assign has a
  record" is close to tautological. It is recorded because a reader running the check will otherwise
  expect a gap and find none.
- **Reissue / supersede.** [SD §7.5] settled it: _"The reissued-BOL problem is solved by the
  interval, not by a new field… The reissue is a new identity Assertion with its own `effectiveFrom`
  and a `supersedes` link. No `issuedAt` field is added."_ Expressible.
- **Void, lost, stolen.** `src:dtr-part-iv` A-413 §C.2, secondary: BL numbers are serially
  pre-assigned accountable stock, a laser-generated BL _"is only accountable when a number has been
  assigned to the form"_, and lost, stolen and void numbers must be reported to DoW PPA, with audits
  every 180 days. **This looks like A9's gap and it is not.** The passage is [A6 §3.2]'s and
  [A6 §3.3]'s already, and A6 read it correctly: _"A number that can be void before any shipment
  exists, and that can be lost without anything happening to any goods, is not an identifier of"_ a
  shipment — it is a fact about the **form**. A number voided before assignment identifies nothing
  at all; it is stock. So the act is an act on a `document`, and [A6 §3.3] already records that no
  act on a document has a record and owes **`documentIssuance`**. A9 adds nothing to that ledger
  either.
- **Assert a party's code.** No subject — §3.6.

**So A9 closes with two reductions and no new owed item**, which is the discipline [A7 §6] arrived
at by finding an owed item pointed at the wrong area: the inventory is a set of claims, and adding a
claim that duplicates one already in it makes the inventory worse, not more complete.

### 3.8 The rubric's `Covers` column, and the residue runs both ways

`rubric.md`'s A9 row reads: _"each party's identifiers (order no., registration no., SCAC, BOL/PRO,
service order no.), correlation between them."_ Run against §3.3's table — [A7 §3.4(c)]'s residue
method, where the leftover is the finding:

**Outward.** Twelve of the twenty schemes answer to none of the five names, enumerated in the test:
`agentCode`, `equipmentNumber`, `gbloc`, `inventoryItemNumber`, `mcNumber`, `sealNumber`,
`shipmentConfirmationNumber`, `shipmentIdShipper`, `sitControlNumber`, `tcn`, `tripNumber`,
`usDotNumber`. The column names no scheme at the **item**, **resource**, **stay** or **trip** grain,
no party-registration scheme except SCAC, and none of the three constructed schemes. A reader who
took the row for an inventory would model five things and miss the stay identifier [SD §7.4] already
depends on.

**Inward, and this is the sharper half.** _"registration no."_ is **two schemes with different
authorities**, and the split matters:

- `src:cfr-49-375` §375.505(b)(16)'s _"Any identification or registration number **you** assign to
  the shipment"_ — the carrier's, **primary and captured**, and offered at §375.519(a)(6) as an
  alternative to the bill of lading number.
- `src:sirva-ade`'s `Brand + RegNumber + RegYear` — the van line's, where _"reg numbers recycle
  across years and brands"_ and `Brand` _"scopes every id"_ (GSD p.5, p.15, **secondary**).

**The second has exactly one witness in the entire external corpus**, it is a partner contract, it
has no `captured/` directory, and its absence elsewhere is **stated rather than inferred**:
`src:weichert-supplier-api`'s own analysis records _"no SCAC, PRO, BOL, registration or driver id —
the van-line identifier set is entirely absent."_ Our own systems carry it three times over —
`src:pegii-longhaul`'s `avl_reg`, `src:pegasus-integration-floors`' `{Brand}:{Number}:{Year}` — and
all of them are `role: mapping-only` and inadmissible.

> **So the one genuinely HHG-specific scheme among the rubric's five is the thinnest-witnessed row
> in the table.** That is not an argument for dropping it; `src:sirva-ade` is a grade-A partner
> contract and [SD §7.1] already built the `vocabularyScope` around its triple. It is an argument
> for knowing which claims in this area rest on one publisher, and for not reading the corpus's
> density on `C6` as density on the terms.

**Three fields in this corpus are routing hints that get read as inventories** — `rubric.md`'s
`v1 detail` column, its `Covers` column, and `sources/registry.yaml`'s `areas:` — and this round
documents two readings of them: this section's, on the `Covers` column, and §1.2 finding 3's, on
`areas:`. [A6 §3.8] and [A7 §3.10] documented the `Covers` column twice before. **No ordinal is
written for any of that**, because the glossary, the rubric and this document would each count it
differently — plan §5's warning, in the one place it is easiest to trip. The pattern is what is
worth naming: **a field written to decide where to look gets read as a record of what was found.**

---

## 4. Weights

**C6 highest**, which is the obvious call and is stated anyway because [A6 §3.9] and [A7 §3.11] both
record theirs: `C6` is _"Identity & references"_ and is this area's own criterion.

**C4 second, and that one is not obvious.** The natural second is `C2` — semantic precision — and it
is the wrong choice here for a measurable reason: **`C2 = 3` is nearly universal on A9**, so it
discriminates almost nothing. What separates a source that can settle a question in this area from
one that cannot is whether it carries the **terms** rather than the mechanism, and that is `C4`
(§2.1). `src:samsara` scores `C6 = 3` / `C4 = 0` and says in its own row that _"the mechanism is
there, the terms are not"_; `src:dtr-part-iv` scores `C4 = 3` and supplies ten of §3.3's twenty rows.
Every decision in §3 turns on that axis, including the central one: §3.2's refusal is argued from
the high-`C6`, low-`C4` group and §3.3's table is built from its complement.

**C7 third**, for `src:dtr-part-iv`'s SF 1200 and for the reissue path [SD §7.5] already adopted.
`C3` and `C5` are `n/a` across almost every A9 row — an identifier has no lifecycle of its own once
§3.7's split is taken, which is a consequence of the decisions rather than an input to them.

[A5 §3.7] is the only other area to put **C4** at the top or second, and the pairing is not a
coincidence: both areas are about things the general logistics corpus does not have. **One caution
about that claim rather than an ordinal for it** — `rubric.md`'s own scoring rules offer
_"A8 weights C4/C6"_ as an example, and [A8] records no weights at all, so the example is an
illustration written before the areas were and not a prior instance. Checking which areas have
actually **recorded** a weighting is a `grep`, and it is the check that stops the rubric's
illustration being cited as a fact.

---

## 5. Cross-area consequences

### To [A6]

1. **[A6 §3.2(a)]'s owed input is discharged for twenty schemes and stays open in principle.**
   `schemeAccountabilityForDId` in `src/rules/identity-schemes.ts` hands `documentIdentitySubject`
   its `boolean | undefined` directly. **D-ID is unchanged**: its signature, its three-valued
   parameter and its `SCHEME_ACCOUNTABILITY_NOT_PUBLISHED` branch all stand, and §3.2 guarantees the
   branch stays reachable permanently rather than until someone gets round to the vocabulary. The
   docstring on `SchemeAccountability` saying `undefined` means _"A9 has not said"_ is now also true
   in the narrower sense that A9 has said, for some schemes.
2. **A third document-accountable scheme.** [A6 §3.2(b)]'s six-document-kind table is unchanged and
   correct; §3.3(c) adds that the PRO is accountable as a **scheme** — `src:nmfta-ebol` makes it the
   document's own resource key — which A6's enumeration by document kind could not have reached.
3. **`documentIssuance` gains a case and no new claim.** §3.7 reduces void / lost / stolen BL numbers
   to A6's owed act rather than minting one, on A6's own reading of the same passage. **A6's act is
   no longer owed** (2026-10-05, [A8 §5] row 17), so the case A9 handed over now has somewhere to
   land — which is the argument for reducing instead of minting, observed working.

### To [A8]

1. **Five identity schemes are blocked on [A8 §9 item 1], and nothing new is owed.** §3.6. The item
   already names DOT/MC, SCAC and agent code among the party entity's fields; what A9 adds is that
   they are not merely **fields** of the missing entity — they are **identity assertions with no
   subject**, which is a second and independent reason to mint it. `ids.ts`'s `TODO(A8 §9 item 1)`
   asks whether the party becomes a fifteenth aggregate kind; §3.6 item 2 records why `partyRole`
   is not the answer.
2. **Nothing is asked of [A8 §5].** `identity`'s row 10 is assigned, `boundBy = SCHEME`, and
   [A8 §4.3] resolves it against the **issuer** — which §3.1's second witness for the
   `issuer`/`authority` split strengthens rather than disturbs.
3. **One observation for the branch grain.** `src:sirva-ade`'s agent code **carries** the branch in
   its trailing three digits (§3.3). A8 owes both the party and the branch grain; the corpus
   publishes an identifier that encodes the second inside the first, which is a shape A8 may want
   and is not A9's to choose.

### To [A1]

The award and the acceptance are **not** collapsed (§3.4). `src:nmfta-ebol`'s
`shipmentConfirmationNumber` is carried as its own scheme, and its unsettled accountability bit
records the reason A1's separation is hard to hold: the subject of an acceptance is an **act**, and
[SD §1.2] has no aggregate for one.

### To [A2] and [A5]

Both hand-offs close without either area moving. [A2]'s `CamisRegNumber` is one row whose positions
A9 reads as evidence about the scheme and never as a fact about the shipment (§3.5); [A5]'s
`ltsRequestNumber` back-reference is already expressible under [SD §7.1] and A5's refusal to model
the permanent-storage boundary is untouched (§3.5).

### To [SD]

1. **§7.1's `issuer` / `authority` split has a second, independent witness** — the PRO — and [SD §7.1]
   is amended to say so, because it currently argues the split from `MS2` alone and a reader may
   take it for an equipment quirk.
2. **§7.2's GBLOC witness is a scheme with no subject.** Recorded at §3.6, and [SD §7.2] gains one
   sentence pointing at it. Nothing in §7.2 changes.
3. **§7.5's canonicalisation policy is load-bearing for a case it was not adopted for** — the three
   constructed schemes (§3.1). One sentence.

### To [catalog]

Nothing. §9 classifies this round as changing no published byte, so no version moves and no change
class is exercised. Recorded here so that the absence is a statement rather than an omission —
[A7 §4] item 14's lesson, which found four `[catalog]` edits with no section declaring them.

### To [`../rubric.md`]

The A9 row's `Covers` column is a prompt (§3.8), and the rubric's note already carries that warning
for the A6 row. A9's addition: the residue runs **both** ways, and the inward half — one name
covering two schemes with different authorities — is the half a reader will not notice.

### To [`../sources/registry.yaml`]

One edit, to the schema comment: `areas:` is a discovery hint written before any source was
analysed, not an inventory of which areas a source scores. §1.2 finding 3. **No entry is changed.**

**Superseded by the cleanup round's B1**, which changed the `areas:` of every source that has a
score table and rewrote the schema comment to state one rule per half. A9's sentence is kept above
as the record of what the field was when this round read it; §1.2 finding 3 carries the amendment.

---

## 6. What A9 leaves owed

1. **`identityScheme` itself, deliberately** (§3.2). It stays on the glossary's Owed page and its
   owner stays A9. **[A8 §9 item 2] leaves `roleClass` owed in the same way and got there first**,
   so this is not a new move; what is new is the ground. A8 owes its vocabulary because the sources
   it needs are unread — `src:uncefact-mmt-rdm`'s 605-value `PartyRoleCode` list ships as a bare
   enumeration with no names — and A9 owes its own because the sources are read and **say the
   vocabulary should not be closed**. The Owed page cannot tell those two apart, which is worth
   knowing before reading it as a backlog.
2. **A definition of SCAC — still owed, and now owed with the fetch ruled out.** Six witness rows
   use the code; none defines the issuing authority's rules, so `definedNotMerelyNamed` is `false`
   and §3.3(b) keeps it there. `src:nmfta-scac` — the **only** registry entry whose `areas:` is
   `[A9]` and nothing else, and the issuing body's own material — was never fetched and is
   `status: skipped` on the **C1 decision of 2026-10-04**: the identifier _concept_ is what
   modelling needs, the six rows above already witness it, and the authority's paid material buys a
   definition nothing in the model consumes. **The decision closes the fetch, not the gap.** This
   entry therefore stays, and what changed is only that it is no longer waiting on anybody: a round
   that wants SCAC _defined_ must reopen the registry entry and argue for the purchase, which is a
   different ask from the one this item used to carry.
3. **The subject of an acceptance** (§3.4). Not minted, and not obviously A9's: it is an act, and it
   is the same shape as [A6]'s `documentIssuance` and [A7]'s `chargeCollection`. Recorded so that
   whoever takes [SD §1.2]'s act-subject question finds three instances rather than two.
4. **Whether `identityScheme`'s members would carry more than one bit** if it were ever published.
   [A6 §3.2(a)] specifies one. §3.3's table carries five columns that are candidates — `identifies`,
   `authority`, `issuerIsTheAuthority`, `definedNotMerelyNamed` and the blocker — and A9 makes no
   claim that they are the right set, because a vocabulary it declines to publish has no member
   shape to argue about.

**And one thing A9 explicitly does not owe**: the party entity (§3.6 item 3). It is
[A8 §9 item 1]'s and adding it here would double-count a single gap.

---

## 7. Confidence, and what would change this

| Claim                                                | Confidence | What would move it                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §3.2's refusal to close `identityScheme`             | **high**   | A source publishing a closed HHG identifier-scheme list **with no escape hatch**. None of the six in §3.2(a) is                                                                                                                                                                                       |
| §3.6's party-grain finding                           | **high**   | Structural, and checked at load and at compile time. It moves when [A8 §9 item 1] lands, not before                                                                                                                                                                                                   |
| §3.3's table being the schemes the corpus witnesses  | medium     | A `needs-user` or `candidate` registry entry that names A9 and is then fetched adds rows. The number of those is a count over a discovery artefact and is deliberately not written here or gated — `source-registry.test.ts`'s header says why. `src:nmfta-scac` is no longer one of them (§6 item 2) |
| §3.4's one unsettled bit being the only one          | medium     | Same. It is a statement about twenty rows, not about the industry                                                                                                                                                                                                                                     |
| §3.8's single witness for the van-line registration  | **high**   | A second external publisher of a van-line registration scheme. `src:weichert-supplier-api` states its absence                                                                                                                                                                                         |
| §3.1's second witness for the issuer/authority split | medium     | Secondary evidence read from one analysis; a capture of the eBOL spec would raise it                                                                                                                                                                                                                  |

**The evidence base's own weakness, stated plainly and enumerated rather than counted.** Exactly two
of the thirteen sources §3.3 cites are quoted at **primary** grade — `src:cfr-49-375` and
`src:milmove-mymove` — and every other citation in the table is a reading of a reading. The three
DoD sources (`src:dtr-part-iv`, `src:dp3-400ng`, `src:dp3-tender-of-service`) have **no captures at
all** and between them witness nine of the twenty rows, including every constructed scheme. Both
facts are gated in `identity-schemes.test.ts` by name.

That does not weaken §3.2 — which rests on the high-`C6` comparator group, where the escape hatches
are quoted directly from analyses of specifications rather than of regulations — and it does weaken
any future attempt to publish the vocabulary **from this table**, which is worth knowing before
someone tries.

---

## 8. What this puts in the executable specification

| What                                | Where                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| The witnessed-scheme table          | `data/identity-schemes.json` + `loadIdentitySchemes` in `src/data.ts`                          |
| **I-ACCOUNT**                       | `schemeAccountability` in `src/rules/identity-schemes.ts`                                      |
| D-ID's input, in D-ID's shape       | `schemeAccountabilityForDId` — the [A6] hand-off, discharged                                   |
| The blocker query and the party set | `schemeBlocker`, `partyGrainSchemes`                                                           |
| **The §3.2 refusal**                | `IdentitySchemeStaysOwed` + its assignment — **a gate**, tampered                              |
| The §3.5 refusal                    | `CORRELATION_IS_AN_OBLIGATION_NOT_A_LINK` — a plain `= true`, with the docstring saying why    |
| The §3.6 type-level refusal         | `tests/conformance/identity-scheme-refuses.ts` — `party` is not an `AggregateKind`             |
| The two load-time invariants        | `loadIdentitySchemes` — a party row needs a blocker; accountability implies a document subject |
| Registration                        | `A9` in `DOCUMENTS`; `I-ACCOUNT` and `IdentitySchemeStaysOwed` in `RULES`                      |
| Tests                               | `tests/conformance/identity-schemes.test.ts`, `tests/conformance/source-registry.test.ts`      |

---

## 9. The version, and the gates

### 9.1 No published byte moves

`npm run catalog` after this round emits schemas **byte-identical** to the ones on `main`. Nothing in
§3 mints a type, a qualifier, an aggregate kind, a vocabulary member or an owed marker; `SchemeName`
keeps its `OwedCode` brand, so `SchemeName.identityScheme` in both emitted faces stays a plain
string carrying its `x-brand`, its `x-owed-vocabulary` and its `x-owed`; and
`data/identity-schemes.json` is a data table that no generator reads — which is [A6 §3.2(d)]'s
finding about `data/canonical-subjects.json`'s `context` list, holding a second time.

**So no change class at [catalog §2.3] applies, and `CATALOG_VERSION` does not move.** A9 joins [A2]
and [A6] as a round whose decisions change nothing on the wire.

> **Read as evidence, not as a formality** — [A7 §9]'s lesson, which is the reason this paragraph is
> here at all. A7's reasoning had started the same way and the diff said otherwise: `owedTo` is
> emitted as a `const`, so correcting an owed item's **owner** was a published change. A9's round
> touches an owed item's _neighbourhood_ twice — I-ACCOUNT is about an owed vocabulary, and §3.6
> names an owed item — so the expectation of an empty diff was checked against the emitted `$defs`
> and not assumed. It is empty because A9 changes no `owedTo` **string** and mints no branch: the
> owner of `identityScheme` was already A9 and its text is untouched.

### 9.2 Gates tampered and watched to fail

Each restored afterwards.

1. **`SchemeName` narrowed to a two-member union in `src/identity.ts`** →
   `identity-schemes.ts: TS2322: Type 'true' is not assignable to type 'never'`. Without this
   tamper there is no evidence `IdentitySchemeStaysOwed` is not another of [A2 §9]'s tautologies. It
   is not: the two sides are declared independently (§3.2(d)).
2. **`'party'` added to `AGGREGATE_KINDS`** → `identity-scheme-refuses.ts` reports `TS2578`
   (unused `@ts-expect-error`), which is also the proof the refuses file is in the typecheck.
3. **`blocker` set to `null` on the `scac` row** → `loadIdentitySchemes` throws naming the row, and
   two assertions fail by name.
4. **`[A8 §9 item 1]` written onto the `tcn` row's blocker** → the mirror invariant fires, naming
   `tcn` and its aggregate kind.
5. **`documentAccountable: true` on `tcn`** → the accountability invariant fires.
6. **A witness removed from `scac`** → the enumerating publisher-base assertion fails by name, and
   so does the widest-row assertion. [A1 §9]'s rule in the direction it was written for, and
   [A7 §9]'s defect pre-empted: **the row count is not the publisher count**, and both numbers this
   document uses are gated.
7. **The registry's new schema sentence removed** → `source-registry.test.ts` fails, so §1.2
   finding 3's one edit cannot be reverted silently.
8. **`dtr-part-iv` given `A9` in its `areas:`** → the sharp-instance assertion fails, which is
   intended: the day the registry is curated, this document's claim must be re-read rather than left
   standing. **This happened** — the cleanup round's B1 is that curation, the assertion failed
   exactly as designed, and §1.2 finding 3 is amended. The assertion is **inverted rather than
   deleted**: the same source is still the sharpest case, now of the gate working.
9. **The `C6` column index swapped for `C4`'s in `c6ShareByArea`** → §2.1's margin assertion fails.
   Worth doing because that gate reads a **position** in a table it does not own, and a gate that
   silently reads the wrong column is [A6 §9]'s half-tamper finding in a new place.

### 9.3 And the pass that found what no gate could

[A7 §9]'s budgeted read-the-diff-and-recount pass earned its place four times here, and all four
defects were claims nothing in the suite could contradict:

1. **_"the only area whose own subject was already on the model's owed list"_** — false. [A4]'s
   subject was the reason vocabulary and it was owed until [A4 §3] published it. The honest form is
   a contrast rather than a superlative, and it is a better opening: A4 could publish and did, A9
   cannot and says why. Now the first paragraph of this document.
2. **_"the first time an area has left its own owed vocabulary owed"_** — false. [A8 §9 item 2]
   leaves `roleClass` owed. Rewritten at §6 into the distinction that actually matters: A8's
   vocabulary is owed because its sources are **unread**, A9's because its sources are **read and
   disagree with closing it**, and the glossary's Owed page cannot tell those apart.
3. **_"six party-grain rows"_** — five, written in three files before the table was counted.
   Corrected, and then **gated by enumerating the five by name** rather than by fixing the number,
   which is [A1 §9]'s rule and the thing that stops it recurring.
4. **_"the two DoD sources supplying ten of the twenty rows"_** — three sources, nine rows. Both
   halves wrong, in the same sentence, in the section about the evidence base's weakness.

**Three of the four are [A7 §9]'s shape exactly** — a count or a superlative in prose that no test
reads — and the fourth is its close cousin. The one claim in this document that survived the pass
because it had been **measured rather than asserted** is §2.1's `C6` density, and it is now gated
(§9.2 item 9). That is the whole argument for the pass in one comparison.

### 9.4 And a second pass, which found four more of the same

The pass above was run before the cross-area edits. Running it **again afterwards** found four more,
which is the finding: **one pass is not enough, because the last edits a round makes are the ones no
pass has seen.**

1. **An ordinal that was still wrong after being corrected once.** §9.3 item 1 replaced "the only
   area" with "the second, after [A4]" — and [A5]'s `Remedy` shipped as `Owed<'remedy', 'A5 — …'>`
   too, so A5 also opened with a piece of its own subject owed to it, and also published. The
   opening now names both and drops the ordinal entirely.
2. **Four documents counting the routing-hint finding differently** — "third routing column",
   "fourth instance", "fourth column", and a "fourth" that had no third. **Plan §5 warns about
   exactly this** ("the glossary, `[A8 §9 item 8]` and this file each count differently. Name the
   blocker, not its position") and the warning was read and then tripped one section later. Every
   ordinal is deleted; the three fields are named instead.
3. **`[A3 §8]`, three times, for a bullet that is in A3's `Cross-area` section.** The rest of the
   corpus cites `[A3 §8]` for the nine acceptance scenarios, so the wrong citation is the one that
   looks right — and no gate reads a section number inside a citation.
4. **"the second area to weight C4 highest or second"** — an ordinal resting on `rubric.md`'s own
   scoring-rules example, _"A8 weights C4/C6"_, which [A8] never recorded. §4 now states the
   comparison and the caution instead.

> **The rule that comes out of this is not "read it twice."** It is that the **cross-area pass adds
> prose after the review pass**, so the review has to bracket it. Every one of these four was
> written or left standing in the last hour of the round.
