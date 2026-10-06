# Domain reference — `roleClass`: round record

**Landed 2026-10-06.** The plan this replaces was
`plans/in-progress/domain-reference-roleclass.md`, whose §1 was marked **not a seed** — it rested on a
measurement taken while the plan was written, and that measurement had overturned the previous plan's
statement of the same item. That was true, and the plan was still wrong about two other things, which
is the thing worth reading here.

**What landed:**

- `docs/domain-reference/sources/stedi-x12-reference/captured/stedi-element-98-party-roles-notes.md` —
  the element-98 read, with the `ROLE_NAMES` cross-walk. Raw page in `local/`, both with sha256 in
  `registry.yaml`.
- **`roleClass` → `refusedOnEvidence`**, held by `RoleClassStaysOwed` in `src/rules/authority.ts`,
  `tests/conformance/role-class-refuses.ts` and `tests/conformance/reason-attribution.test.ts`.
- **`ATTRIBUTION_NO_PARTY`**, declared by `Attribution`'s shape, and **A8-NO-PARTY** over it.
- Catalog **0.6.3**, with two change classes minted: `refusedOwedVocabulary` and `newShapeBranch`.
- Amendments to nine documents, three of them corrections to claims the corpus already carried.

---

## 1. The decision — `roleClass` does not close, and the non-party value is not in it

**Element 98 is not a role vocabulary.** It is `Entity Identifier Code`, the identifier qualifier on an
`N1` loop, and its own one-sentence definition is the whole of its semantics: _"Code identifying an
organizational entity, a physical location, property or an individual"_. The rendered list delivers
all four — `CA Carrier` beside `SF Ship From` beside `BA Battery` (_"that portion of the surface of
land…"_) beside `D1 Driver` — in one flat, ungrouped table, with freight, healthcare, mortgage,
oil-and-gas and education sharing one alphabet.

So it fails `roleClass` twice over, and the two reasons do not depend on each other:

1. **No class axis.** One table, no category column, no role family. A class list cut out of it by
   hand would be ours, which is the `[ORIGINAL]` value `[SD §0]` forbids.
2. **No member meaning no party at all.** The nearest misses are `B2 Other Unlisted Type of
Organizational Entity` (an organization), `QD Responsible Party` (a person) and `ZZ Mutually
Defined` (the slot is filled by something the partners agreed — **not** that it is empty).

That is `[A9 §3.2]`'s shape reached by the opposite argument: A9's sources publish an escape hatch
beside every closed list, while element 98 publishes a list at the wrong grain. Both are now
`refusedOnEvidence`; `unitOfMeasure` is the one vocabulary still `pending`.

**The non-party value is published anyway, and it is not a member of the refused vocabulary.**
`FORCE_MAJEURE` and `DEADLINE_LAPSED` are published codes caused by no party — `src:dtr-part-iv`
§C.4.b makes non-response to an award _"a typed event caused by nobody"_ — and `[SD §2.4]` makes
`roleClass` mandatory, so until now neither could be recorded without inventing a member. The value is
`ATTRIBUTION_NO_PARTY`, declared by `Attribution`'s **shape**, on an argument the corpus supplies:
`roleClass` is the class of _party_ a reason is attributed to, a reason caused by no party has no class
of party, and `[SD §2.6]`'s own note draws the line by sending a shortfall to _"an unknown role class
rather than to nobody"_. So `unknown` is a class and stays inside the refused vocabulary; nobody is
outside it. Same mechanism as `Reason`'s `OTHER` and `ActOutcome`'s `COMPLETED` — "declared by the
shape, not by the vocabulary A4 published".

**`tariffOwner` stays owed and was deliberately NOT repointed.** Element 98 has `TI Tariff Issuer`,
which names the function `[A8 §5]` row 11 calls "the tariff owner". That is a counterpart, not a
closure: what blocks the `ROLE_NAMES` member is `[A8 §2]`'s addition test — a role is added there
because it **asserts facts** and ADE has no slot for it — and X12 naming a function is not X12
asserting a fact. `§3 item 16` says repoint when what an item is owed **for** changes; it has not.

---

## 2. What the plan got wrong — three things, and the first is the one it was proudest of

**The plan's §1.1 was right about the previous plan and wrong about its own key citation.** It said:
_"`fork-time` §941 says so in as many words: the non-party value is 'the member of the role vocabulary
that element 98 is least likely to supply'."_ That sentence is `[fork-time §5.3]`'s and it is about
**`customer`**, not about a non-party value. Two consequences, and both are now written into the
corpus:

- **No document predicted the non-party absence.** It is this read's finding, not a confirmation of
  anyone's forecast. A plan that reports a prediction nobody made has invented a corroboration.
- **`[fork-time §5.3]`'s actual prediction is refuted.** Element 98 **does** carry `LW Customer`. The
  reasoning survives — X12's customer is the `BY Buying Party (Purchaser)` end of a commercial
  relationship, not the householder who signs the inventory — so the ORIGINAL DESIGN stands and only
  the forecast was wrong. It was one page away and had never been checked.

And the shape of the error is the plan's own §4 lesson turned on itself: **the plan cited a `§n` that
was a line number**, which §5's last bullet names as a defect of this very corpus. A line number in
`fork-time` landed inside §5.3 and was read as if it were §9.4.1-ish. Citing the heading would have
made the mistake impossible, because §5.3's heading is "The customer is an asserter".

**The plan said "store it under `captured/` … it is public, non-normative material, so it is
committable", and omitted the constraint that governs it.** `src:x12-transportation`'s registry entry
says _"Reference code lists, never copy them into the repo"_, and `sources/README.md` puts a public
page with no stated license in `captured/` as **notes + short quoted excerpts, not a full mirror**. The
precedent was already there — `src:x12-212-trailer-manifest`'s capture is notes of stedi pages whose
own header says _"no licensed code list is reproduced whole"_. So the capture follows the policy and
not the plan, and the raw page lives in gitignored `local/` with a sha256, which is exactly what
`src:uncefact-mmt-rdm` lacked.

**The plan predicted the round was "a fetch, two decisions and an amendment". It was a fetch, two
decisions, two new change classes, a new named rule and nine amendments.** `§3 item 3`'s warning — "the
class you need may not exist yet" — fired twice in one round, which had not happened before.

---

## 3. What the emitted diff located that the decision did not — the third time

`§3 item 8` again, and this is its sharpest instance yet because the decision was not merely
incomplete, it was **wrong about what the wire would enforce**.

The no-party branch emits, on both faces:

```json
{ "party": false, "roleClass": { "const": "NO_PARTY" } }
```

`"party": false` is JSON Schema's boolean-false schema, so the prohibition on `party` is real — better
than predicted. But the **sibling** branch still types `roleClass` as the open `OwedCode` string, which
accepts `"NO_PARTY"` beside a `party` and therefore accepts every record the new branch forbids. The
`anyOf` **does not discriminate**: branch 1 subsumes branch 2.

Two things follow, and both are now stated rather than left to be inferred:

- **The change is additive with no restriction at all.** No record that validated stops validating, on
  either face — which is the cleanest classification the catalog has had, and it needs none of the
  owed-marker-was-published argument that `publishedOwedVocabulary` and `publishedOwedShape` rest on.
- **The branch discloses a constraint it cannot enforce, and the refusal is why.** The TypeScript type
  enforces it in-repo, because `OwedCode` is a brand and the literal is not assignable to it. The wire
  starts enforcing it the day `roleClass` is published as a closed union — which is precisely the edge
  `RoleClassStaysOwed` guards. A reader who assumes an `anyOf` must be discriminating would get this
  backwards, so `newShapeBranch`'s declaration, `[catalog §2.3]`'s row and `[catalog §2.4]`'s row all
  say it.

---

## 4. The two classes, and why neither existing one would do

| Class                   | What it is                                                          | Why not an existing member                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refusedOwedVocabulary` | `pending` → `refusedOnEvidence`; two annotation values on each face | `newAnnotation` is a **new** keyword on a shape that had none, and its own declaration refuses to be stretched: "stretching that member to cover both would have made it mean two things". `repointedOwedOwner` moves an owed value's **owner** and leaves its state alone. |
| `newShapeBranch`        | A new `anyOf` branch; nothing removed, nothing narrowed             | `publishedOwedShape` **replaces** an `Owed` branch and therefore removes a `$defs` entry a consumer may have pinned. This takes nothing away. `newOptionalPayloadField` is a field, not a branch.                                                                           |

`refusedOwedVocabulary` is the **mirror image** of `publishedOwedVocabulary`: one closes a gap, the
other argues the gap does not close. It is the fourth member of the family that names changes to the
model's bookkeeping about its own incompleteness, and the weakest — the other three move a `const`,
this moves an annotation a validator ignores.

Both classes joining `ADDITIVE_CHANGES` is itself `newClosedEnumMember`, exactly as
`repointedOwedOwner` was at `0.6.1`. **0.6.2 → 0.6.3**, patch slot, three classes, one bump.

Fixed in passing: `catalog.ts`'s `publishedOwedVocabulary` docstring said this was "the one every
remaining owed vocabulary — `roleClass`, `unitOfMeasure`, `identityScheme` — will make". That was
already false when it was written (A9 had refused `identityScheme`) and is doubly false now.

---

## 5. The new rule — A8-NO-PARTY, and the assertion it made testable

**A code whose `partyRequired` is `true` may not be attributed to nobody at all.** The five are
`INSTRUCTED_CHANGE`, `PARTY_ABSENT`, `PARTY_NOT_READY`, `PARTY_REFUSED` and `PARTY_RESCHEDULED`,
enumerated by name in `src/` and compared both directions against `data/reasons.json` — so a
`partyRequired` flipping fails naming the code that moved.

**The reason it lands in this round and not in A4's is worth keeping.** `partyRequired` asserted
something nothing could contradict: there was no no-party value for "must name a party" to be
incompatible with. The same goes for `[A4 §5]` item 1's biconditional — _"`partyRequired` is true for
every `PARTY`-scope member and no other"_ — which was prose nobody could fail until now, and is gated
here.

> **A lesson about gates, which is new.** The owed-closures round's finding was that a passing
> assertion can hide a to-do item. This is the shape underneath it: **a flag can be unfalsifiable not
> because nobody wrote the gate, but because the value that would contradict it does not exist yet.**
> Publishing a value is therefore an occasion to go looking for the claims it has just made testable —
> and `grep` will not find them, because nothing about `partyRequired` mentions no-party.

---

## 6. Two of my own claims were wrong, and the gates caught both inside one run

**`INSTRUCTED_CHANGE` does not prove `partyRequired` and `scope = PARTY` come apart.** My draft
asserted it did, as the reason `attributionIsLegalFor` reads the code list rather than `scope`. It is
`PARTY`-scoped and the two sets are **identical** — which is `[A4 §5]` item 1's own sentence, so the
right move was to gate A4's biconditional rather than to invent a distinction. The test fired on the
first run.

**`DEADLINE_LAPSED`'s docstring counted `CAUSE_UNKNOWN` among the codes attributing to nobody.** The
contradiction is inside the corpus and the slip is visible in A4's wording: `[A4 §5]` wrote that
`CAUSE_UNKNOWN` "attributes to nobody **yet**" — a _third_ state — and `[A1 §3.6]` dropped the "yet"
and counted it to three. `[SD §2.6]` breaks the tie the other way. Both ordinals withdrawn, **two**
codes positively require the value, and `CAUSE_UNKNOWN`'s attribution is recorded as **open** with
three candidate readings — a party of unknown class, no party, or unknown whether any party — and no
pick, because deciding it needs the vocabulary that was just refused.

**And the review pass found three more, in my own prose rather than in my own code.** A claim that
`[A8 §10]` says something about depending on a single publisher — **it does not**, its rows rate the
authority rows and not the cast, so the sentence became a new confidence item for A8 to add with the
reason it was not added on the way past. `ZZ Mutually Defined` called "still a party" in three places.
Two ordinals in gate docstrings and a bare "five industries". **The pass also reached the previous
commit message**, which carried a test count; amended out, because nothing regenerates one.

---

## 7. Method, and why it is recorded in the capture rather than only here

**Two summarizer reads of the same page agreed with each other and were wrong on both numbers that
matter.** They reported 829 code values and said the page carries no per-code definitions. A parse of
the retained page bytes gives **1312** and **161**. The `TI Tariff Issuer`, `NS Non-Temporary Storage
Facility` and `X2 Party to Perform Packaging` findings came out of that parse and out of no summary;
so did every negative, which is the load-bearing half.

> **The rule: a summarizer's negative is weaker than a grep, and two agreeing summaries are not a
> primary source.** They agree because they share a model and a prompt, not because they checked each
> other. Retain the bytes and parse them — and record the method beside the figures, so the next
> reader knows which standard each number was gathered to.

---

## 8. Gates

`tsc` silent · `eslint` clean · the vitest suite green · Alloy every command matched its expectation ·
glossary, catalog and context map regenerated and round-trip-validated · `prettier --check` clean over
both trees with no exception. **No count is written here**, which is `§3 item 10`.

Every new gate was tampered after the commit that introduced it, and each failed by name:

| Tamper                                                    | What fired                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Narrow `RoleClass` to a closed union                      | `RoleClassStaysOwed`'s assignment, `TS2322: Type 'true' is not assignable to type 'never'` |
| Let the no-party branch carry a `party`                   | `role-class-refuses.ts`, `TS2578: Unused '@ts-expect-error' directive`                     |
| Let `roleClass()` admit the no-party spelling             | the casing test in `reason-attribution.test.ts`                                            |
| Drop a code from `CODES_THAT_FORBID_NO_PARTY_ATTRIBUTION` | the both-directions comparison, naming the missing code                                    |
| Flip `partyRequired` in `data/reasons.json`               | four tests, including A4's biconditional and the generator staleness checks                |
| Remove the `Exact<>` assignment, table still "refused"    | `data-tables.test.ts`: "a refusal held by prose alone cannot fail"                         |
| Table says "pending" while the gate is live               | the same comparison from the other side, plus the wire's `x-owed-state` tests              |

One gate fired without being tampered, which is the context map's: adding the `RoleClass` type
reference to `rules/authority.ts` **promoted the concept onto the join surface** and failed
`context-map.test.ts` by name. That promotion is a deliverable rather than a side effect — the refusal
is the first edge between the reason shape that needs the vocabulary and the area that owes it — so the
enumeration was changed deliberately and the threshold was not touched.

---

## 9. What is next

`plans/in-progress/domain-reference-party-entity.md` — `[A8 §9 item 1]`, the party entity, which the
context map measured as the load-bearing blocker and which this round did nothing to relieve.
