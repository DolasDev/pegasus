# Domain reference — the cleanup round: COMPLETE

**Landed 2026-10-03.** The round that paid down what the nine area rounds **found, recorded and did
not fix**. Its plan was `plans/in-progress/domain-reference-cleanup.md`, rewritten as the next
round's per this effort's convention — the live plan is now
`plans/in-progress/domain-reference-context-map.md`.

## What shipped

| Item                                         | What                                                                                  | Where               |
| -------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------- |
| **A1** prettier on `alloy/run.mjs`           | Cleared an exception every round since A7 carried in its verification notes           | `db59b7e5`, PR #769 |
| **A2** the `[SD §4.7.3]` disclosure gate     | Rescoped to each class's declaration unit, with an exactly-once rule                  | `db59b7e5`, PR #769 |
| **B3** `[catalog §2.3.1]`                    | The pre-1.0 breaking-change rule: minor carries breaking, patch carries additive      | `286605c6`, PR #772 |
| **A-CLASS** `repointedOwedOwner`             | Declared at last, and both §2.3 tables now name their classes                         | `344f45dd`, PR #774 |
| **A3** `x-owed` on the `Owed` value branches | Closes `[catalog §2.3]` gap item 3 and strengthens `repointedOwedOwner`               | `344f45dd`, PR #774 |
| **A4** per-vocabulary owed annotation        | `x-owed-state` + `x-owed-why`, so pending and refused are distinguishable on the wire | `344f45dd`, PR #774 |
| **B2** the glossary's Owed page              | Grouped by state, with the reason, the citation and the gate holding the refusal      | `344f45dd`, PR #774 |
| **B1** the registry's `areas:`               | Generated for the scored half, gated per source; hand-written hint kept for the rest  | PR #776             |

Catalog **`0.6.0` → `0.6.1`** — the first patch-slot bump, under the rule this round wrote.

Four pipeline fixes landed alongside, none of them planned: three audit-advisory flips (#755, #760,
#773 — two with **no fix available**, allowlisted on probed reachability) and a jest timeout
`apps/mobile` had outgrown (#775).

## What the round found that its own plan did not know

**Four of the seven planned items carried something the plan had wrong or did not predict.** The
plan's instruction to verify each defect before fixing it earned its place every time.

- **A-CLASS, a whole defect nobody had recorded.** `repointedOwedOwner` was documented in
  `[catalog §2.3]`, used by `[catalog §2.4]`'s `0.6.0` row, and described by `catalog.ts`'s own JSDoc
  as _"a class this bump adds"_ — and was never a member of `ADDITIVE_CHANGES`. `index.json`
  published seven additive classes where the document documented eight, and the glossary omitted the
  class entirely. **Found while writing a gate for something else**, which is the argument for
  gating a claim even when you believe it.
- **A2's prescription covered six of sixteen entries.** "Scope the check to the bullet that declares
  the member" — only six of the sixteen have a declaring bullet; the rest are declared in prose. The
  fix needed three declaration shapes.
- **B2's design had the gate the wrong way round.** The plan said put the state in the `data/` table.
  A table that merely restates a type-level gate **cannot contradict it**, so the pair would have
  been worthless as a check. The state is declared in the table AND derived independently from the
  AST, and a test holds them together.
- **B1's first gate was a tautology, and B1's own measurement corrected the plan twice.** See below.

## The transferable lessons

**Scoping a gate is half a fix; the other half is EXACTLY ONCE.** Narrowing `includes(phrase)` from a
202-line section to a declaring unit only moves masking somewhere smaller. Requiring exactly one
occurrence closes it at every granularity — and needs its own tamper.

**A filtered collection asserted against its own filter predicate is a tautology**, at any language
level. B1's hand-written-half gate asserted that entries with no score table have no scored rows,
where the half was filtered on exactly that. `[A2 §9]`'s finding, one level down, where it is easier
to write and just as unfailable. **Tampering is the only thing that finds it.**

**Then run the replacement against real data.** B1's replacement required a non-empty `areas:` and
immediately named three entries where empty is correct. A gate that fires on correct data is a gate
the next person deletes. Two passes, neither substituting for the other.

**Pick a version slot on a mechanical ground, not an aesthetic one.** `[catalog §2.3.1]` assigns the
minor slot to breaking and the patch slot to additive while the major is `0`, because `^0.6.0` admits
`0.6.1` and excludes `0.7.0` — so a caret range behaves correctly unaided. Every other assignment
makes the range lie in one direction.

**Write the rule before the round that needs it.** B3 landed first and `0.6.1` descended from a rule
already on `main`, rather than being chosen in the PR that invented it.

**Measure before correcting someone else's count, and prefer naming to counting.** `GOTCHAS.md`
claimed four NUL bytes in one file, fixed at source; measured, that file still had them, a second
generator had one and was never named, and a test file had one nobody had recorded. Rewritten to name
the files and carry a re-measure command.

**Reading the rendered prose diff caught defects no gate could** — a cross-reference to a section
that does not exist, an invented ordinal, a bullet contradicting the paragraph inserted above it, and
a claim that a test asserted more than it did. A7's and A9's lesson, confirmed again: **no gate in
this package reads prose for sense.**

**A NUL byte can be load-bearing.** `documents.test.ts`'s single NUL was a `phrase ?? '\0'`
never-matching sentinel inside the broken assertion — which is _why_ `grep` skipped the file. Find
out what one is doing before removing it.

**`testTimeout` is a shared resource.** Turbo runs `test` in parallel across every package, so
~10 seconds of new compiler-API work in one package tipped a 15s budget in another. The budget was
raised where it was marginal, not in the package that exposed it.

## What this closes, and what it does not

**Closes:** every defect in Group A and Group B. The `[catalog §2.3]` gap items 1 and 3. `[A9 §1]`'s
registry finding, amended rather than left standing, with its sharp-instance assertion inverted.

**Does not close:** **Group C**, six items blocked on something the round did not control — §7 of the
next plan carries each as a one-line ask. `[A8]`'s ledger, the three owed vocabularies (all three now
with a reason on record and on the wire), `[SD §10.4]`'s two remaining bullets, and the three missing
pieces of the old `model/` layer.
