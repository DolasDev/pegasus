# AI Chat Assistant — operations administrator onboarding (Phase 0)

How the operations administrator gets hands on the Pegasus API, what they can
and cannot reach, and what they produce. This is Phase 0 of
`plans/in-progress/assistant-phase0.md`.

**The goal is not to build anything.** It is to put the person who knows what
users actually ask in front of the real data surface, and have them write down
30–50 real questions with their correct answers. That file — the eval set — is
the acceptance gate for every later phase. Everything else here exists to make
writing it easier.

---

## 1. Mint the API key (tenant admin does this once)

`/settings/developer` is behind `requireRole('tenant_admin')` — the whole
`/settings/*` subtree is (`apps/tenant-web/src/router.tsx`, `settingsLayout`).
An operations administrator cannot mint their own key, so a tenant admin does it
and hands it over.

1. **Settings → Developer → Create API client.**
2. Name it for the person and the purpose, e.g. `assistant-eval-authoring`.
3. Assign **only** the **Reporting** role. It is read-only by construction —
   `apps/api/src/authz/policies/30-personas/reporting.cedar` permits nothing but
   reads. Do not add a second role "to be safe"; permissions are the union of
   every role assigned, and a wider key would let the author explore a surface
   the assistant will not have.
4. Copy the `vnd_…` key at creation time — it is shown once.

> The key runs as a **service-account persona**, not as a real user. That is the
> right tool for exploring from a terminal, and the wrong tool for judging what
> a real user would see. Phase 1's in-product lab executes as the caller's own
> Cognito login, which is what makes its role scoping authentic.

## 2. Base URLs and the one auth header

| Environment | API root                           |
| ----------- | ---------------------------------- |
| Production  | `https://api.pegasus.dolas.dev`    |
| QA          | `https://api.pegasus-qa.dolas.dev` |

The key goes in a standard bearer header — `Authorization: Bearer vnd_…`
(`apps/api/src/middleware/m2m-app-auth.ts`):

Keep the key in an environment variable rather than typing it into the command
— a key pasted on a command line ends up in your shell history:

```bash
read -rs PEGASUS_KEY && export PEGASUS_KEY   # paste the key, press enter
curl -s -H "Authorization: Bearer $PEGASUS_KEY" https://api.pegasus.dolas.dev/api/v1/runtime/moves
```

Every list endpoint returns `{ data, meta }`, with `meta` carrying the paging
information.

## 3. Browse the surface

- **Swagger UI:** `https://api.pegasus.dolas.dev/docs` — every documented
  endpoint, with a "Try it out" button. Paste the key into **Authorize** first.
- **Raw spec:** `https://api.pegasus.dolas.dev/openapi.json` — the same thing as
  a file, which is the form to hand an AI assistant.

## 4. What a Reporting key can actually reach

This matters more than it looks, and it is the one place where the plan's
original sketch was optimistic. **A `vnd_` key only reaches the machine-to-machine
router.** The tenant web app's own endpoints sit behind a Cognito session and
reject API keys outright — that is not a permissions problem to be fixed by
adding roles; the two live on different routers (`m2mV1` vs `v1` in
`apps/api/src/app.ts`).

**Reachable with the Reporting key:**

| What            | Endpoint                                        |
| --------------- | ----------------------------------------------- |
| Customers       | `GET /api/v1/runtime/customers`                 |
| Quotes          | `GET /api/v1/runtime/quotes`                    |
| Moves           | `GET /api/v1/runtime/moves`                     |
| Invoices        | `GET /api/v1/runtime/invoices`                  |
| Orders (legacy) | `GET /api/v1/orders`, `GET /api/v1/orders/{id}` |
| Events          | `GET /api/v1/events/{eventType}`                |
| Event types     | `GET /api/v1/event-types`                       |

**Not reachable with any API key — the entire Operations → Planning surface:**
shipments, trips, drivers, and the reference data behind their filters
(`/api/v1/onprem/longhaul/*`). These are Cognito-session-only.

**This does not block Phase 0.** The eval set is questions, correct answers, and
where the answer comes from — not API transcripts. For a planning question, read
the answer off the Planning screen and record the screen in `source.screen`,
with the endpoint that serves it in `source.endpoint` (or `null`). Phase 1's
tools execute as your own Cognito principal and reach that surface normally, so
nothing authored this way goes to waste.

## 5. Explore conversationally

Point an AI coding assistant (Claude Code, or any tool that can make HTTP calls)
at `openapi.json` and the key, and ask it questions in plain language — it will
work out which endpoint answers them. This is the fastest way to build intuition
for what the data can and cannot support, and it previews exactly what the
assistant will be doing later: choosing a tool, calling it, reading the result.

Keep the key out of anything that gets committed or shared. Treat it like a
password; if it leaks, a tenant admin revokes it on the same screen that minted
it.

## 6. The deliverable

**30–50 real questions**, each with the correct answer and its source, in
`apps/api/src/assistant/evals/ops-baseline.json`.

The format, what makes a good case, and how to keep answers from going stale are
documented in [`apps/api/src/assistant/evals/README.md`](../apps/api/src/assistant/evals/README.md).
Three worked examples are in the file already — replace them.

Two things worth insisting on, because they are what the set is really for:

- **Include the awkward phrasings.** The tidied-up version of a question is not
  the one people type.
- **Include questions the asker should not be allowed to answer** — a driver
  asking about billing, a warehouse user asking about margins. Those cases are
  how a permissions regression gets caught, and no amount of "it reads nicely"
  testing substitutes for them.

Once the file has real cases in it, Phase 1 has its acceptance gate and can
start.
