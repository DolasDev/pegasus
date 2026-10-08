# Domain reference — the party entity (`[A8 §9 item 1]`): the round record

**Landed 2026-10-08 at catalog `0.6.4`.** `party` is an `[SD §1.2]` `aggregate` kind;
`[A9 §3.6]` is closed; `[A8 §9 item 1]` is **partially** closed with its residue enumerated.

This replaces `plans/in-progress/domain-reference-party-entity.md`. The planning pass that produced
it is preserved in §2 and §3 below, because **three of its own claims were refuted by measurement**
and the refutations are the transferable part.

---

## 1. What shipped

### The deliverable, in one line

`AGGREGATE_KINDS` gained `'party'`. That is the whole mechanism, and the reason it is the whole
mechanism is the measurement that opened the round: **`identity`'s canonical subject family is
`anyAggregate`, whose membership _is_ `AGGREGATE_KINDS`** — `[SD §7.1]`, _"`subject` may be **any**
aggregate kind"_. So no record type, no fact class and no subject family were added, and the five
`party`-grain identity schemes became assertable by construction.

### The emitted diff, read before classifying (§3 item 8)

Purely additive on both faces. Nothing removed, nothing narrowed, nothing repointed:

- new `$defs/AggregateId.party` — `{"type":"string","x-brand":"id:party","x-aggregate":"party"}`
- new `$defs/SubjectRef.party`, and **it discriminates**: `"aggregate": {"const": "party"}`. Checked
  rather than assumed, because `0.6.3`'s new `anyOf` branch did not.
- one branch each on `SubjectRef`'s `anyOf` and on `$defs/SubjectRef.family.anyAggregate`
- **one line in `index.json`**, where `identity`'s subject list gains `party`. That line is the
  deliverable: `[A9 §3.6]`'s five schemes becoming assertable, visible on the wire.

**Two additive classes, one bump — `0.6.3` → `0.6.4`, the patch slot — and the first round since A5
to mint neither of them.** `newAggregateKind`, and `repointedOwedOwner` (A7's, on its second use):
`partyRole`'s authority row read _"[A8 §9 items 1-2] — both the party entity and the role enum are
undefined"_, and **this round discharges one of those two blockers**, so it re-points to item 2 alone
and the survivor is a **refusal** rather than a pending list. §3 item 16's test — what the item is
owed FOR changed — rather than tidiness.

> **The second class was nearly missed, and the near-miss is the fourth finding.** The round swept
> the **phrase** it had falsified (`PartyId` as _"an identifier with no aggregate behind it"_) and
> fixed every site. It had not swept the **item**. `grep "A8 §9 item 1"` found present-tense
> _"until it lands"_ prose in `vocabulary.ts`'s `partyRole` member — **a second copy of the exact
> docstring shape the round had already named as its fourth inversion, in a different file** —
> `rules/authority.ts`'s third `TODO`, `data/authority-table.json`'s four `owedTo` reasons, and
> `partyRole`'s authority row, **which is emitted**. **Sweeping the phrase you changed is not the
> same as sweeping the item you closed**, and only the first is discoverable from the diff you have
> just written.
>
> **Three of those sites carried a misattribution older than this round**, which is why they read as
> closable. `stayAuthorisation`'s and `chargeCollection`'s absence notes and `OpensStay`'s each said
> their asserting role is _"a party class `[A8 §9 item 1]` has not defined"_ — but an asserting role
> needs a `ROLE_NAMES` member, which is **item 2**'s, and §9 item 2 owes the government offices
> **by name**. `[A5]` carried the same sentence twice and is annotated rather than rewritten.
> `authority-table.json`'s four reasons gave the party entity's absence as why an issuer _"cannot be
> an enum member"_; the entity exists now and the issuer is **still not a role**. **A citation naming
> the wrong owed item reads as closable the day that item closes** — which is exactly how all of
> these surfaced, and the only reason they did.

### Everything else the round touched

| What                                                         | Why                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| five blockers off `data/identity-schemes.json`               | the schemes have a `subject` now                                                                 |
| `loadIdentitySchemes`'s invariant **inverted**               | no row may name `[A8 §9 item 1]` — it used to be the opposite                                    |
| `identity-scheme-refuses.ts` **inverted**                    | the discharged claim asserted positively; a **new** refusal in its place                         |
| `identity-schemes.test.ts` **inverted**                      | the blocker invariant and its tamper test, which now pushes the blocker _back_                   |
| `ids.ts`'s `partyRole` docstring                             | it said _"Note what is **not** here: a `party`"_                                                 |
| `SchemeSubject`'s union **collapsed**                        | its second branch was the literal `party`, "which is not one" — the fossil, not the finding      |
| `data/canonical-subjects.json`                               | `families.anyAggregate.members` is a hand-written copy of the enum, compared as a set            |
| `custody.ts`'s `TODO` **re-pointed** to items 2-3            | minting a subject does not resolve `performedBy` to a `partyRole`                                |
| `index.ts`'s barrel comment and `schemeBlocker`'s docstring  | both narrated the finding in the present tense; `schemeBlocker` now returns `null` for every row |
| two gates that counted now **compare**                       | `toHaveLength(14)` dated on contact; the TODO ledger's two renamed markers added by name         |
| the ordinal sweep (its own commit)                           | two TODOs each claimed "a fifteenth aggregate kind", one for a **place**                         |
| `[A8 §9 item 1]`, `[A9 §3.6]`, `[SD §7.1]`, `[catalog §2.4]` | marked annotations in both directions                                                            |

### What it deliberately did not do

- **`PartyId` stays branded `party`** beside the subject's `id:party`. Owed to `[A8]` with the
  successor shape (`SubjectRef<'party'>`) and the class (breaking). §3 below is why.
- **`legal name`, the branch grain and the hierarchy stay owed**, each with a named blocker.
- **No `place` aggregate**, though `custody.ts` wants one and the legal-name evidence needs one.

---

## 2. The three things the plan got wrong, which is the transferable part

> **§1 of the plan announced itself as a seed and was right to.** What is worth carrying is not that
> it was wrong but **how each error was caught**, because two of the three were caught by running
> something and one by reading a function the plan cited.

### (a) The question's own dichotomy was wrong — caught by doing the measurement it asked for

§1.3 item 1 asked whether the party's attributes are **fields** or **`identity` assertions**. The
corpus answers in **three** buckets: the branch grain and the hierarchy are **neither** — both are
already witnesses on the `agentCode` row (_"the code CARRIES the branch"_), and the residue is
`[A8 §9 item 3]`'s grain question plus a party-to-party relation no fact class holds.

**And the enumeration was wrong in both directions at once.** `[A8 §9 item 1]`'s prose writes
"DOT/MC number" as one phrase where the table carries **two** schemes, and **never names `gbloc`** —
which the table carries and blocks on that very item. So "the party's attributes" had no single
cardinality, and `[A9 §3.6]`'s claim that item 1 _"already names these very identifiers"_ held for
four of five.

**Lesson: when a plan asks you to classify a set into two buckets, count the set first.** Both the
bucket count and the set were wrong, and one gate (`identity-schemes.test.ts`, _"exactly five rows
identify a party, and they are named"_) already had the right answer.

### (b) `legal name` is a **field** — wrong, and it was an inference from the model's own silence

The first write-up called it a field "because nothing else in the model could hold it". That is not a
measurement of the corpus, and `[SD §0]`'s disclosure rule is what it violates. Going to the primary
bytes found `[A8 §9 item 1]`'s one uncited attribute **has** a citation — `src:cfr-49-375`
§ 375.505 _"Must I write up a bill of lading?"_ (b)(1) — and that it publishes something no field can
hold: a **disjunction** (legal **or** trade/DBA), **registry-scoped** (_"as it is registered with
FMCSA"_), **bundled with a physical address** the model has no aggregate for.

Decisively: `src:sirva-ade`'s `Resource` is `{Id, Name, Type, Owner}` whose `Id` _"can contain agent,
vendor, driver **or equipment** code based on the resource `Type`"_ — so its `Name` names a company, a
person or a **tractor**. **The one grade-A contract with a name field is the one that fuses the
grains.** A party must be defined before it can be named, so the name is blocked on **item 3**, not
on item 1.

**Lesson: "nothing in our model can hold it, therefore it is X" is a claim about us, not about the
source.** And read the primary bytes: the DP3 corroboration is `secondary` because that source has
**no `captured/` and no `local/`** — graded by the rule in `identity-schemes.json`'s own `$comment`.

### (c) The brand unification was "required, not polish" — wrong, and the cited function says so

This is the sharpest one, because **the plan it refutes is this round's own first draft.** The draft
argued that unifying `PartyId` with `AggregateId<'party'>` was required, because **A8-SELF** compares
two parties and would not typecheck across two brands. One `grep` at the function:

```ts
export function corroborationIsIndependent(authoritative: PartyId, corroborating: PartyId): boolean
```

**Both sides were already `PartyId`.** A8-SELF compares two **references** and never compares a
reference with a `subject`. It typechecked before the round and typechecks after it unchanged.

**Lesson, and it is `[A9 §9]`'s one level in: a citation is two claims — that the text says this, and
that the text is right.** The draft cited a real rule for a property that rule does not have. §3
item 22 _was_ right that publishing a value makes old claims testable; the inference from that to
this particular fix was invented. **The round's own §3 item 10 habit saved it:** going to look at the
declaration rather than trusting the summary.

**And the over-correction is worth recording too.** Having lost the premise, the next instinct was
"no live rule needs it, so the brand is fine". That is also wrong: **every other aggregate is
referenced by `SubjectRef<K>`, never by a bare id** (`LegEndpoint.stop`, `CustodyHolder.partyRole`).
`PartyId` is a bare brand _because_ there was no aggregate — `ids.ts` says exactly that — so after
the mint **the fossil is the brand, not the comparison.** The defect is real; the licence to break
was what the false premise supplied.

---

## 3. Decision 2, recorded in full, because it is owed rather than done

**The brand is not unified, and the diff experiment is why the obvious fix was rejected.**

`generate-catalog.ts`'s `refineName` names a branded `$def` `<alias>.<brand-suffix>`, and the
generator emits **one `$def` per exported type alias that a record references**. So
`PartyId = AggregateId<'party'>` publishes **two `$defs` with byte-identical bodies under two
names** — `AggregateId.party` **and** `PartyId.party` — while `#/$defs/PartyId` **ceases to exist**.
Re-measured with `export type { PartyId }`: identical. **It trades two brands for one concept for
two `$defs` for one concept, and dangles a published `$ref` as well.**

So the only arrangement publishing one party id is to **delete the alias**, which removes the
published `$defs/PartyId` that six `$defs` reference: `AssertedBy`, `Attribution`, `CustodyHolder`,
`IdentityValue`, `PartyRoleValue`, `VocabularyScope`. **`AssertedBy` is on every envelope.**

**`[catalog §2.3]` has no row for that in either table, and the round minted none.** The mechanical
test every additive row turns on — _"no record that validated stops validating"_ — **passes**: both
targets are `{"type":"string"}`. What breaks is a `$ref`-following reader. **Whoever closes it mints
the class and must say WHICH READER breaks**, because leaning on §2.3's mechanical test alone would
classify it additive and be wrong. A change class with nothing classified under it is worse than
none, which is why `removedPublishedDef` was costed and then left unminted.

**The cost argument, stated correctly rather than conveniently.** `[catalog §2.3.1]` makes breaking
cost the **minor** slot for as long as the major is `0`, and `[catalog §2.4]` forbids `1.0.0` until
§5's inventory is discharged. **This round and a later round pay the same slot.** "Later is dearer"
was the first draft's argument and it was arithmetic it had not done.

---

## 4. Gates — tampered and watched to fail, and one tamper refuted my own claim

Committed first (§3 item 6), then each tamper run and restored.

| Tamper                                                  | What fired                                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| remove `'party'` from `AGGREGATE_KINDS`                 | `TS2322` on the new positive assertion **and** `TS2367` on `partyGrainSchemes`' comparison — both directions                               |
| add `'party'` to `NON_ACT_TYPES` (make it a fact class) | **`TS2578`** at `identity-scheme-refuses.ts` — the new refusal                                                                             |
| write the blocker back onto `scac`                      | `DataDefect` naming the row and the version: _"scac identifies a party, and `[A8 §9 item 1]` minted the party aggregate at catalog 0.6.4"_ |
| drop `party` from `data/canonical-subjects.json`        | `DataDefect` naming the **set difference**, which is why it took one read                                                                  |
| drop `document` from `SUBJECT_FAMILIES.anyAggregate`    | the loader's set comparison, upstream of every assertion                                                                                   |

> **The fifth tamper refuted a claim I was about to put in this record.** I expected it to show that
> the old `toHaveLength(14)` gate **passes a half-tamper** — 15 members minus `document` is 14 — and
> that the new `toEqual([...AGGREGATE_KINDS])` catches what the count missed. **It does not, and the
> reason is better than the claim:** `loadCanonicalSubjects` compares the data table against
> `SUBJECT_FAMILIES` as a **set** and throws before any assertion in that file runs. The count was
> never what held the claim.
>
> **So the count→comparison change is still right, for a narrower reason: it stops the gate DATING.**
> `toHaveLength(14)` was a stand-in for "the whole enum" and went wrong the moment the enum grew.
> That is §3 item 10's rule — but **not** §6's "a gate that passes a half-tamper", and writing it up
> as the latter would have been exactly the over-claim this corpus keeps catching. **Run the tamper
> before naming its shape.**

All gates green at the end: `tsc` silent · `eslint` clean · **539 tests** · Alloy exits clean · all
three generators are prettier fixed points · `prettier --check` clean over both trees with no
exception.

### The §Cross-area pass, run in both directions after the last prose (§3 item 14)

**It found two things, which is why §4 says bracket the pass rather than precede it.**

1. **An edit made and not declared.** `src/index.ts`'s barrel comment and `schemeBlocker`'s own
   docstring both narrated `[A9 §3.6]` in the present tense (_"identifies the one thing `[SD §1.2]`
   has no aggregate for"_). Both were rewritten, and neither appeared in this record's table until
   this pass added the row above.
2. **A cross-reference asserted and wrong — in the NEXT round's plan, written minutes earlier.** Its
   §1.3 item 4 cited `[SD §7.3]` for _"releasing and receiving parties"_. That phrase is
   **`[A8 §7.3]`**'s — heading _"There is exactly one instant where two roles are jointly
   authoritative, and the model is forbidden to pick"_ — because `[A8 §9 item 3]` writes a bare
   "§7.3" meaning its own. `[SD §7.3]` is "The vocabulary scope". **A bare `§n` across documents is
   the same defect as a line number pretending to be a section**, and it took reading both headings
   to see it. Repaired, with the heading named.

**One claim verified rather than remembered:** `[A7 §6]`'s heading is "What only the user can decide,
and what is owed elsewhere", and it is the right citation for the double-counting warning this record
leans on twice.

**And a third thing, found on the second lap of the same pass** — which is A9's lesson exactly
(_"budgeting the pass is not the same as the pass working"_). The sentence repairing defect 2 **above**
pointed at "§5's last bullet" of the next round's plan for the cite-a-heading rule. **That plan's §5
last bullet is about `[SD §10.4]` and the `place` aggregate.** A false cross-reference, inside the
paragraph recording a false cross-reference, written while fixing one. The rule had lived in the
_previous_ plan's §5 and the new plan carried §5 by reference instead of restating it. Repaired by
carrying the bullet forward for real, so the reference now resolves. **Run the pass twice.**

---

## 5. What `[A8 §9 item 1]` still owes, so nobody re-derives it

Each with its blocker named — the annotation on the item itself carries the same list:

1. **`legal name`** — blocked on **`[A8 §9 item 3]`**. Primary citation now recorded; three reasons
   it is not modellable (disjunction, bundled address, fused grain). The tempting
   `legalName`-as-a-scheme reading is recorded and **rejected**: `[SD §7.1]` defines a scheme as one
   that _"DEFINES who assigns and what it identifies"_, and **a name does not identify**.
2. **the branch grain** — **item 3**'s, and `agentCode`'s trailing three digits already carry it, so
   what is owed is the grain question and not a field.
3. **the hierarchy** — a party-to-party **relation**, and **no `AssertionType` holds one**. Not
   waiting on item 3; waiting on a fact class that does not exist.
4. **the party's id shape** — §3 above. Owed to `[A8]`, closing it is breaking.

---

## 6. What follows

`[A8 §9 item 3]` (person vs organisation vs crew-member grain) is now the **blocking** item rather
than merely the next one: three of the four residues above route through it. Then the command side
and the aggregate lifecycles, which have never been planned and need their own research pass.

**And one standing trap for whoever mints the next aggregate kind.** `custody.ts` wants a `place`,
and its `TODO` no longer claims an ordinal — on purpose. Minting a member touches `src/ids.ts`, the
three generated artefacts, the TODO ledger if a marker's name moves, and **one place a `grep` for
the member name will not find**: `data/canonical-subjects.json`'s `families.anyAggregate.members`, a
hand-written copy of the enum that `loadCanonicalSubjects` compares as a **set**. **That is the one
this round's plan missed, and the suite found it** — which is also why the failure was one read
rather than a session: the `DataDefect` names the set difference.
