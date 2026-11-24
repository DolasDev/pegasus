# AI Chat Assistant — eval set

`ops-baseline.json` is the acceptance gate for the AI Chat Assistant. Every later
phase of `plans/todo/ai-chat-assistant.md` is judged against it, and every
prompt edit the operations administrator makes is scored on it. It is the
difference between tuning the assistant's context deliberately and tuning it on
vibes.

It is **authored by the operations administrator**, not by engineering. Getting
started: [`docs/ai-assistant-ops-admin-onboarding.md`](../../../../../docs/ai-assistant-ops-admin-onboarding.md).

## What goes in it

30–50 questions a real user would actually type, each paired with the answer
that is genuinely correct and a note of where a human reads that answer today.
The file holds a **drafted candidate set**: the questions, roles and sources are
written, but most `answer` cases still carry an `AUTHOR:` expected answer, empty
`mustInclude`, and `<PLACEHOLDER>` values in the question (a real order number,
trip number, driver name). Those cases score as _ungraded_ until the operations
administrator fills them in from the screen named in `source`. The `refuse`
cases are graded already. Cases whose notes start with **DECIDE** depend on a
persona grant that may be a gap rather than intent — settle the grant first.

Aim for a spread, not 40 variations of one question:

- **The daily questions.** Whatever gets asked out loud in the office every
  morning. These matter most; if the assistant misses these it has no value.
- **The awkward phrasings.** Write the question the way someone actually types
  it, abbreviations, missing words and all — not the tidied-up version.
- **Questions spanning two things.** "Which of this week's shipments have no
  driver assigned yet?" is a harder and more realistic test than either half.
- **Refusals** (`"outcome": "refuse"`). A driver asking a billing question, a
  warehouse user asking about margins. These catch a permissions regression that
  no amount of "does it answer nicely" testing will.

### Choosing `mustNotInclude` markers for a refusal

Use markers that only **leaked data** would contain — a formatted amount
(`" USD"`, `"$"`), a raw field name (`plan_pack`, `trip_title`), a real order
number. Never a topic word: a correct refusal says "I can't see invoices", so
`"invoice"` as a marker fails the very answer the case wants.

## The shape of a case

Enforced by `schema.ts` and checked in CI by `schema.test.ts`, so a malformed
case fails the build instead of quietly scoring as a miss.

| Field                     | Meaning                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `id`                      | Stable kebab-case id. Never reuse one — pass-rate trends are keyed on it.                                |
| `question`                | Verbatim, as a user would type it.                                                                       |
| `askedAs`                 | The role asking. Must match a role name in `apps/api/src/authz/role-options.ts`.                         |
| `outcome`                 | `answer` — it should answer. `refuse` — it should decline for lack of access.                            |
| `expected.answer`         | The correct answer in prose: what a knowledgeable colleague would say.                                   |
| `expected.mustInclude`    | Substrings that must appear — figures, names, statuses. This is the graded part.                         |
| `expected.mustNotInclude` | Substrings that must never appear. Required on every `refuse` case; without it the case asserts nothing. |
| `source.screen`           | Where a human reads this today. Always required — it is the provenance of the expected answer.           |
| `source.endpoint`         | The API path serving it, or `null` if none does.                                                         |
| `notes`                   | Optional. Anything the next reader needs, e.g. "only true during peak season".                           |

### On answers that go stale

Most useful questions are about live data, so a literal expected answer rots
within days. Two ways to handle it, both fine:

- Put the **stable** part in `mustInclude` — an order number, a driver's name, a
  status word — and leave the volatile count out of it.
- Or write the case against a period that has closed ("last month", a specific
  trip that has already delivered), so the correct answer never changes.

What does not work is `mustInclude: ["14"]` on a count that changes hourly: it
fails for the wrong reason and trains everyone to ignore a red result.

## Running it

Phase 1 ships `npm run assistant:eval`, which replays this file against the
current draft prompt and reports pass rate, mean tool calls per question, and
mean cost per question. Until then the file is authored and reviewed by hand —
the schema check (`npm test -w apps/api`) is the only automation.
