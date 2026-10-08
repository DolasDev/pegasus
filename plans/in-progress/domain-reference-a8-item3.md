# Domain reference — person vs organisation vs crew-member grain (`[A8 §9 item 3]`): plan

**Written 2026-10-08**, to be read by a session with **no prior context**. Everything needed to
start is here or is named by path. Read this whole file before starting.

It replaces `plans/in-progress/domain-reference-party-entity.md`, whose round landed in full at
catalog `0.6.4`; the record is `plans/completed/domain-reference-party-entity.md`, and its three
plan-was-wrong findings are carried into §4 rather than left to be rediscovered.

---

## Resume here

**THIS ROUND HAS NOT STARTED.** The party round is fully landed and is **not** this round.

### Where

- **Branch:** none yet. The party round landed on `chore/dr-party` in
  `/home/steve/repos/pegasus-deps-advisory-flip` (Postgres `pegasus-pg-deps-advisory-flip`, port
  **5459**). That branch's work is complete; check whether it has merged before branching from it.
- **Last domain-reference commit:** the party round's record and this plan.

### Status

- [ ] §1.3 — the measurements, **before** designing anything
- [ ] §1.2 — the decision: does the model distinguish a person from an organisation, and how?
- [ ] implementation, gates, tamper pass, cross-area edits, round record

### Next action

**Run §1.3 item 1 — enumerate what each source actually publishes at which grain — because the
party round's experience is that the plan's framing is what breaks first.** Do not start with §1.2.

---

## 0. Why this item is now the blocking one, measured rather than asserted

**Three of the four residues `[A8 §9 item 1]` left route through this item**, which is the party
round's measurement and is written into that item's own annotation:

1. **`legal name`** — blocked here. `src:sirva-ade`'s `Resource` is `{Id, Name, Type, Owner}` whose
   `Id` _"can contain agent, vendor, driver **or equipment** code based on the resource `Type`"_, so
   its `Name` names a company, a person or a **tractor**. **A party must be defined before it can be
   named.**
2. **the branch grain** — blocked here. `agentCode`'s trailing three digits already carry the branch,
   so what is owed is the grain question (_is a branch its own party?_) and not a field.
3. **`custody.ts`'s `TODO([A8 §9 items 2-3])`** — re-pointed by the party round rather than removed.
   Whether a leg's `performedBy` resolves to a `partyRole` needs this item **and** item 2's role
   vocabulary, which is `refusedOnEvidence`.

The fourth residue — the party's id shape (`PartyId` vs `SubjectRef<'party'>`) — does **not** route
through here and is independent. See the record's §3.

---

## 1. THE DELIVERABLE

### 1.1 What `[A8 §9 item 3]` says, and the material it already names

Read the item itself first: `docs/domain-reference/analysis/A8-authority-skeleton.md` **§9 item 3**.
It already gathers four sources that disagree, and names them:

- `src:milmove-mymove`'s **`MTOAgent`** is a _person_ (`RELEASING_AGENT` / `RECEIVING_AGENT`);
- `src:atlas-world-group-api`'s **`OnSiteStaffMember`** carries `role_ID` / `role_Description` bound
  to specific `stop_Number`s — **column names only**, and `[SD §0]` holds that Atlas's vocabulary is
  _"not merely unfetched but unpublished"_, so **nothing may be scheduled against fetching it**;
- `src:sirva-ade`'s **`Resource`** fuses companies, people and **equipment** (`Tractor`, `Trailer`)
  into one `Type` enum;
- `src:dp3-tender-of-service` **NTS §1.4.13.1** requires an **NTS TSP company official** — a named
  individual, not the company — to sight-verify firearms within 72 hours.

And the item states the question it owes — quoted verbatim, bare `§n` and all, because the bare
reference is **A8's own** and resolves inside A8 (see §1.3 item 4): **"§7.3's 'releasing and
receiving parties' is written at company grain, and A8 must decide whether the _individual_ who
signs is a distinct asserter."**

### 1.2 The decision this turns on, and it is NOT yet a schema question

Unlike the party round — where `ids.ts` stated the schema question outright — **nothing in `src/`
asks this one in a decidable form.** That is the first thing to establish rather than assume. The
candidate shapes, none of them costed yet:

- **One `party` kind with a discriminating attribute** (person / organisation / equipment). Cheap on
  the wire; needs a vocabulary, and a vocabulary needs a source. `src:sirva-ade`'s `Type` enum is the
  only published candidate and it **fuses equipment in**, which `resource` already models.
- **Two aggregate kinds** (`party` and, say, `person`). Additive under `[SD §1.2]`, but it splits
  every `PartyId` reference site and so interacts with the id-shape item the party round left owed.
- **Neither — the individual is an `assertedBy` property, not a subject.** `[SD §1.1]` already _"puts
  the role on the assertion rather than on the party"_, so there is a live precedent for pushing a
  distinction onto the assertion instead of the subject. **Costed at zero on the wire if true.**
- **Refuse on the evidence**, like `roleClass` and `identityScheme`. Four sources disagreeing at
  three grains is the shape that has twice produced a refusal in this corpus rather than a
  vocabulary. **This is a live outcome, not a failure mode** — and `[A9 §3.2]`'s and
  `[A8 §9 item 2]`'s refusals are the worked examples.

### 1.3 What to MEASURE before designing — this is the planning pass

Nothing below is a step to execute. **The party round's lesson is that the plan's own framing breaks
first**, so each item is a question whose answer changes the design.

1. **What does each source publish at which grain, enumerated by name rather than counted?** The
   party round's first measurement found `[A8 §9 item 1]`'s own list wrong in **both** directions —
   a two-scheme phrase written as one, and a scheme omitted entirely. **Assume item 3's list has the
   same defect until you have checked it**, and check it against the captures, not the analyses:
   `ls -d docs/domain-reference/sources/*/captured` and `.../local` are the two halves.
2. **Does `resource` already hold the equipment half?** `src:sirva-ade`'s `Resource` fuses equipment
   in, and `[SD §1.2]` already has a `resource` kind with `equipmentNumber` and `sealNumber` schemes
   against it. **If the fusion is SIRVA's accident rather than the domain's, item 3's question is
   narrower than it looks** — person vs organisation only.
3. **Is the individual ever an ASSERTER, or only ever named in a value?** This is the question that
   decides between the third candidate and the others, and it is answerable from the corpus:
   `src:dp3-tender-of-service`'s company official **sight-verifies**, which is an assertion;
   `ProofOfDeliveryName` (`src:sirva-ade`) is a _value_ on a delivery, which is not. **Enumerate
   which of the four sources puts an individual in an asserting position.**
4. **What does `[A8 §7.3]`'s "releasing and receiving parties" actually require?** — **A8's own
   §7.3**, heading _"There is exactly one instant where two roles are jointly authoritative, and the
   model is forbidden to pick"_, which A8 calls _"the strongest-sourced finding in the document"_.
   **Not `[SD §7.3]`**, which is "The vocabulary scope" and has nothing to do with this; §9 item 3
   writes a bare "§7.3" and means its own. _(This plan cited the wrong document on its first draft —
   caught by the §Cross-area pass, and §5's bullet on bare `§n` citations now carries the general
   form: **cite the heading**, and verify by reading the target.)_
   Read it with `[SD §4.8.3]`'s fold before assuming the company grain is a defect — the party round
   found that `custody.ts`'s union exists because two **published inputs** disagree, not because the
   model is careless.
5. **Does any of this reach the wire?** `[SD §1.1]`'s `assertedBy {party, role}` is on **every**
   envelope, so a person/organisation distinction landing there is a change to every record.
   **Measure the emitted diff before classifying** — §3 item 8, which has now located something the
   decision did not predict **four rounds running**.

### 1.4 What this round must not do

- **It must not reopen either refused vocabulary.** `identityScheme` (`[A9 §3.2]`) and `roleClass`
  (`[A8 §9 item 2]`) are `refusedOnEvidence` with live gates.
- **It must not mint a `legalName` field or scheme as a side effect.** The party round recorded the
  evidence **and** the rejection of the scheme reading; closing the name is a decision of its own
  once this item lands.
- **It must not schedule anything against fetching Atlas.** `[SD §0]` forbids it, in terms.
- **It must not unify the `PartyId` brand** unless it finds the rule that needs the comparison. That
  item is independent and the record's §3 states what closing it costs.

---

## 2. Current state and the gate commands

Catalog at `specVersion` **0.6.4**. `party` is an `aggregate` kind. `[A9 §3.6]` is closed.

```
npm run test        -w @pegasus/domain-reference
npm run lint        -w @pegasus/domain-reference
npm run typecheck   -w @pegasus/domain-reference
npm run alloy       -w @pegasus/domain-reference
npm run glossary    -w @pegasus/domain-reference
npm run catalog     -w @pegasus/domain-reference
npm run context-map -w @pegasus/domain-reference
```

**No count is written here on purpose** (§3 item 10). The commands produce it in about five seconds.

---

## 3. Landing a change — the recipe, unchanged and still load-bearing

The party round followed `plans/completed/domain-reference-party-entity.md`'s §3 and **items 2, 8, 10
and 14 each caught something**. Rather than restate the list, read §3 of the **previous** plan as
preserved in that record, and note the two items the party round added evidence for:

- **§3 item 2 — "fill the per-member table in `data/`" is not optional, and the table may not be
  where you look.** `data/canonical-subjects.json`'s `families.anyAggregate.members` is a
  hand-written copy of `AGGREGATE_KINDS` that the loader compares as a **set**. A `grep` for the new
  member's name does not find it. The suite does, and names the set difference.
- **§3 item 8 — read the emitted diff, and run the experiment rather than reasoning about it.** The
  party round's planned fix for the brand collision was **refuted by regenerating the catalog**: it
  produced two byte-identical `$defs` under two names, which no amount of reading the source would
  have predicted.

---

## 4. The procedural lessons, with the party round's three added

Read §4 of the record (`plans/completed/domain-reference-party-entity.md`), which carries the
accumulated list. The party round adds three, and the third is the sharpest yet:

> **A plan that asks you to sort a set into two buckets may be wrong about the buckets AND the set.**
> `[A8 §9 item 1]`'s attributes needed three buckets, and its own enumeration was wrong in both
> directions. **Count the set before you sort it.**
>
> **"Nothing in our model can hold it, therefore it is X" is a claim about us, not about the
> source.** That inference is how `legal name` got classified as a field with no citation, in a
> corpus whose `[SD §0]` exists to stop exactly that.
>
> **A citation is two claims — that the text says this, and that the text is right — and this time
> the plan that failed the test was my own, one draft earlier.** The brand unification was argued as
> required because A8-SELF "compares two parties across two brands". `corroborationIsIndependent`
> types **both** parameters as `PartyId`. One look at the declaration. **And the over-correction is
> part of the lesson**: having lost the premise, the next instinct was "so the brand is fine", which
> is also wrong — every other aggregate is referenced by `SubjectRef<K>`, so the brand is a fossil.
> **Losing an argument for a change is not an argument against it.**
>
> **And one about tampering: run the tamper before naming its shape.** The party round nearly
> recorded that a count gate "passes a half-tamper". It does not — the loader's set comparison
> catches it upstream. The count was still worth replacing, for the narrower reason that it **dates**.

---

## 5. What is blocked, and on what — ask the user items, do not schedule them

### Still the user's, and still only one

1. **C2 — what a signature asserts.** **ANSWERED IN PRINCIPLE 2026-10-04: the user will supply the
   wording, and it has not arrived yet.** `[A6 §6]` owes it to the user explicitly, no corpus source
   publishes it, and **it must not be inferred from the four published procedures** — that is the
   `[ORIGINAL]` guess `[SD §0]` forbids. Record it as **`[USER]`** with the user's own words quoted.
   **This item is adjacent to the present round**: a signature is the case where an _individual_ acts
   and `src:dp3-tender-of-service`'s company official is the corpus's clearest instance. **Do not
   resolve C2 as a side effect of item 3.**

### Recorded modelling questions — none is a user ask

Unchanged from the previous plan's §5 except as noted; read it in the record. The ones this round
touches:

- **`[A8 §9 item 1]`'s four residues** — §0 above. Three route through this item.
- **`CAUSE_UNKNOWN`'s attribution** needs the refused `roleClass` vocabulary; not closable by effort.
- **`[A8 §9 item 5]`** (role cardinality) — the party round did **not** reach it, and did not promise
  to. A8-SELF is now testable against a party **subject** for the first time, which may make part of
  item 5 decidable. **Measure; do not promise** — the party round's own §3 item 22 instance was the
  claim that turned out to rest on a false premise.
- **`[A9 §3.3(b)]`'s SCAC gap** stays open with the fetch ruled out. The party round gave SCAC a
  `subject`; it did **not** give it a definition. `definedNotMerelyNamed` is still `false`.
- **`[SD §10.4]`** still carries items open, and **`custody.ts` still wants a `place`** — the
  standing candidate for the next aggregate kind, whose `TODO` deliberately no longer claims an
  ordinal.
- **A bare `§n` cited ACROSS documents, and it is not one plan's defect.** `[A2]`'s §Cross-area note
  to `[A3]` cites _"(§1207, §1289, §3.3's diversion row, §5.1's note at :544)"_, and neither `1207`
  nor `1289` is a heading in either document — they are **line offsets** into `[A3]`. Repairing it is
  `[A2]`'s and `[A3]`'s, via a marked annotation; recorded here so a round that opens either document
  for another reason fixes it in passing. **The same defect has a second form that this corpus hits
  more often: a bare `§n` that is a real heading in the WRONG document.** `[A8 §9 item 3]` writes
  "§7.3" meaning **A8's own**, and this plan's own §1.3 item 4 read it as `[SD §7.3]` on its first
  draft — which is "The vocabulary scope" and unrelated. **The general form: cite the heading, and
  where the headings are named rather than numbered, name the heading.** The `roleClass` round is the
  proof it is not cosmetic: a line-number citation is what let a plan attribute a prediction to a
  section making a different claim.

---

## 6. How to work here

Read §6 of the record. Nothing in it is superseded. The two entries most likely to matter here:

- **A gate must read the thing that DECLARES**, and **a gate whose subject is what a generator EMITS
  must read what the generator emits.**
- **Read the existing tests for the records you are writing about**, and **read the context map's
  debt section**, which enumerates every `TODO(…)` in `src/` with the document that owes it — two of
  them now name this item.

---

## 7. Starting the next session

Work on a branch in an existing worktree; nothing in `packages/domain-reference` needs Postgres, and
the owed-closures, context-map, `roleClass` and party rounds all did exactly that at no cost.

**Read before writing anything:**

1. **§1.3 of this file** — the measurements. §1 is a seed and says so.
2. `plans/completed/domain-reference-party-entity.md` — **§2 especially**, the three plan-was-wrong
   findings, and §5 for the residue this item inherits.
3. `docs/domain-reference/analysis/A8-authority-skeleton.md` **§9 item 3** and its **§9 item 1
   annotation**, then **§7.3** and **§3**.
4. `plans/todo/ci-blockers-after-security-backlog.md` — **"Five diagnosis traps"** and **"Do not
   commit these"**, before touching anything.
