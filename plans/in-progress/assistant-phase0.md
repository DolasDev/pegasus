# AI Chat Assistant — role-scoped Q&A over the Pegasus API

## Context

Tenant users today answer questions about their own operations by navigating to the right
screen and reading it. The ask is a chat surface where a user types a question and an AI
agent answers **using exactly the data that user's role already permits** — no more, no less.

Two things make this tractable here rather than a research project:

1. **The API is already the answer.** Every bounded context has paginated read endpoints, and
   every one is gated by a Cedar action via `requirePermission(Actions.X)`. If the agent's
   tools _are_ those endpoints, executed server-side under the caller's own principal, then
   role scoping is not something we build — it is something we inherit.
2. **Permissions are already introspectable.** `listAllowedPermissions()` in
   `apps/api/src/lib/authz.ts` already answers "what may this principal do?", which is exactly
   the input needed to decide which tools to even show the model.

**Explicitly ruled out: RAG / vector store.** Embedding shipments, quotes, and invoices into a
shared index and retrieving by similarity re-creates from scratch the per-role, per-tenant
access control that Cedar already enforces correctly — and a retrieval index goes stale the
moment a record changes. Tool-use over the live API is both more correct and less code. Do not
re-litigate this without a concrete requirement that tool-use cannot serve.

A second goal shapes the sequencing: the **operations administrator**, not an engineer, should
own the agent's context — its system prompt, its domain glossary, its worked examples. So the
prompt is product data with version history, editable in-app, not a string constant in a
deploy. Engineering builds the loop; ops owns the words.

**Outcome:** phase 0–1 put a working, instrumented agent in the ops admin's hands within their
own role scope. Phases 2–3 widen it to gated roles, then to everyone.

---

## Decisions

| Decision          | Choice                                                 | Why                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retrieval         | Tool-use over existing read endpoints                  | Inherits Cedar role scoping; never stale                                                                                                                              |
| Inference host    | **Claude Platform on AWS** (Anthropic-operated, SigV4) | No API key in Secrets Manager — the Lambda role authenticates. AWS Marketplace billing. Same-day parity with the first-party API.                                     |
| Model             | **`claude-opus-5`**                                    | Removes model quality as a variable while ops tunes context. Re-evaluate against the eval set at GA; the seam below makes the swap cheap.                             |
| Provider coupling | Thin `InferenceProvider` seam                          | Tool registry, Cedar filtering, traces, prompt store are all provider-agnostic. Switching providers = one adapter file + one env var.                                 |
| Transport         | Dedicated Lambda + Function URL, `RESPONSE_STREAM`     | See "The 29-second problem" below.                                                                                                                                    |
| Rollout gating    | **New Cedar action, not a capability flag**            | `usePermissions().hasCapability()` in `apps/tenant-web/src/auth/permissions.ts` **fails open** (absent ⇒ `true`). A Cedar action fails closed and is server-enforced. |
| v1 tool surface   | **Read-only**                                          | No mutations. The model's output must never drive a state change.                                                                                                     |
| Persistence       | Conversations + per-tool-call traces from day 1        | The trace table _is_ the lab's debugger, the audit log, and the eval substrate.                                                                                       |

### Assumptions (flagged, proceeding)

- **Tenant PII leaves our infrastructure.** Customer names, addresses, and shipment details go
  to the inference provider as tool results. Claude Platform on AWS is Anthropic-operated under
  the standard commercial retention posture. Confirm this is acceptable — and confirm whether
  any tenant contract forbids it — before phase 2 exposes it beyond internal staff. If a tenant
  must be excluded, the Cedar action is the per-tenant off switch.
- **Tool results are untrusted input.** A customer note field can contain text shaped like an
  instruction. Because v1 tools are read-only and the model cannot trigger actions, the blast
  radius is a wrong answer, not a wrong write. Revisit hard before any write-capable tool.

---

## The 29-second problem

`packages/infra/lib/stacks/api-stack.ts` sets the API Lambda to `timeout: 29s`, deliberately
under API Gateway's hard 30s integration cap, behind a buffered `ANY /{proxy+}` proxy
integration. Opus 5 thinks by default; a single turn with 2–3 tool rounds will exceed that
budget routinely, not occasionally. And a buffered response means the user stares at a spinner
for 20 seconds — unacceptable chat UX regardless of the cap.

**Therefore: the assistant gets its own Lambda with a Function URL in `RESPONSE_STREAM` invoke
mode**, bypassing API Gateway entirely. 15-minute ceiling, real token streaming.

- Auth: verify the Cognito ID token in-function, reusing the `jose`/JWKS logic from
  `apps/api/src/middleware/tenant.ts`. Do not fork it — extract the verify-and-resolve-principal
  step into a shared helper and have both call sites use it.
- CORS configured on the Function URL for the tenant-web origins.
- Client uses `fetch` + `response.body.getReader()`, not `EventSource` — we need POST and an
  `Authorization` header. `packages/api-http` has no streaming support; add a sibling
  `streamFetch` rather than contorting `apiFetch`.

> ⚠️ **`CONCURRENCY 10` IS THE GA BLOCKER — start this in week 1.** Both AWS accounts are
> capped at 10 concurrent Lambda executions. Ten held streaming connections starve the entire
> platform API. Open the AWS limit-increase request immediately (it takes days), and set
> **reserved concurrency** on the assistant function so it can never consume the shared pool.
> This gates phase 3, not phase 1 — but the lead time means it must start first.

---

## Phase 0 — Ops-admin enablement (near-zero engineering, start today)

> **Status: engineering side DONE** (branch `feat/assistant-phase0`). Shipped: the
> onboarding doc `docs/ai-assistant-ops-admin-onboarding.md`, and the eval-set
> scaffold `apps/api/src/assistant/evals/` (zod schema + CI-enforced validation +
> authoring README + `ops-baseline.json` with three worked examples).
> **Still owed by people, not code:** mint the key (step 1), the ops manager's
> Claude Code seat (step 3), and the eval set itself (step 4) — which gates Phase 1.

Unblocks the ops manager while phase 1 is built, and produces the eval set that phase 1 needs.

1. Issue them a `vnd_` API key via **Settings → Developer** (`apps/tenant-web/src/routes/settings.developer.tsx`),
   bound to a service account with the **read-only `reporting` role** — the existing flow, no code.
2. Point them at `GET /openapi.json` and the Swagger UI at `/docs`.
3. Set them up with Claude Code so they can explore the real data surface conversationally.
4. **Their deliverable is the eval set**: 30–50 real questions an ops user would ask, each with
   the correct answer and which screen/endpoint it comes from. This becomes
   `apps/api/src/assistant/evals/ops-baseline.json` and is the acceptance gate for every later phase.

> A `vnd_` key runs as a **service-account persona**, not as a real user. It is right for CLI
> iteration, but the in-product lab (phase 1) must execute as the caller's **Cognito principal**
> — otherwise the ops admin's evals won't reflect real role scoping.

### Verified against the code — the reachable surface is narrower than step 1 implies

A `vnd_` key only reaches the **`m2mV1`** router; the tenant app's own endpoints hang off `v1`
behind `tenantMiddleware` (Cognito session) and reject API keys outright (`apps/api/src/app.ts`).
That is a router split, not a permissions gap — no amount of extra roles widens it.

**Reachable** with the `reporting` role (its Cedar grants are ReadQuote / ListMoves / ReadMove /
ReadInvoice / ReadCustomer / ReadOrder / ReadSalesman / ReadEvent):
`GET /api/v1/runtime/{customers,quotes,moves,invoices}`, `GET /api/v1/orders[/{id}]`,
`GET /api/v1/events/{eventType}`, `GET /api/v1/event-types`.

**Not reachable by any API key:** the whole Operations → Planning surface —
`/api/v1/onprem/longhaul/*` (shipments, trips, drivers, filter reference data). Which is exactly
where an ops admin spends their day, and where phase 1's headline tools (shipments list/detail,
trips list/detail, drivers) will read from.

**Deliberately not fixed here.** Widening `reporting.cedar` or re-mounting the longhaul reads on
`m2mV1` is real API work outside this phase's "near-zero engineering" boundary — and it would be
throwaway, because phase 1's tools execute as the caller's Cognito principal and reach that
surface natively. The eval set is questions + correct answers + provenance, not API transcripts:
planning answers get read off the screen and recorded with `source.endpoint`, which the eval
schema allows to be `null`. Nothing authored that way is wasted.

---

## Phase 1 — Assistant backend + tool registry + Assistant Lab

### 1a. Cedar actions

`apps/api/src/authz/actions.ts` — add two entries to `Actions` / `ALL_ACTIONS`:

- `UseAssistant` — grant in `authz/policies/30-personas/{operations-admin,tenant-admin}.cedar` **only**.
- `ManageAssistantPrompt` — grant to the same two personas.

Both surface automatically through `GET /api/v1/me/permissions` (`apps/api/src/handlers/me.ts`),
so the frontend gate is `usePermissions().has('assistant:use')` with no new endpoint.

### 1b. Tool registry — the heart of the feature

New `apps/api/src/assistant/tools/`. One module per tool; a registry entry is:

```ts
{ name, description, inputSchema, action: Actions.ListMoves, run(ctx, input) }
```

- `description` must be **prescriptive about when to call it** ("Call this when the user asks
  which shipments are scheduled, delayed, or assigned to a driver"), not just what it does.
  Trigger conditions in the description are what drive tool-selection accuracy.
- `run` calls the **existing repository layer** with `ctx.db` (tenant-scoped Prisma) — reuse
  `apps/api/src/repositories/*`; do not re-implement queries and do not HTTP-call ourselves.
- Per request: filter the registry by `listAllowedPermissions()`, then **`authorize()` again
  inside every `run`** — defense in depth, so a tool that leaks into the list still can't execute.

**Start with ~8 tools, not 40.** Ops-facing reads only: shipments list/detail, trips
list/detail, drivers, customers, quotes, invoices. `handlers/runtime-reads.ts` and
`handlers/longhaul-cloud/*` are the models to follow.

**Cost and accuracy both live here.** Tool results are ~10k of a ~16k-token turn. Return
narrow, purpose-shaped projections — 20 rows with 8 relevant columns, not 100 rows with 91.
Cap every tool's row count server-side and tell the model in the description that results are
capped, so it narrows its filters instead of silently reasoning over a truncated set.

### 1c. Agent loop

New `apps/api/src/assistant/`:

- `provider.ts` — the `InferenceProvider` seam. `ClaudeAwsProvider` uses `AnthropicAWS` from
  the `anthropic` SDK (`pip`-equivalent: `npm i @anthropic-ai/sdk`), region + workspace id from
  env, SigV4 from the Lambda role.
- `loop.ts` — use the SDK **tool runner** (`client.beta.messages.toolRunner` with `betaTool`
  and raw JSON Schema), not a hand-rolled loop. Its per-turn hooks are where the permission
  filter and trace capture attach.
- Enable **prompt caching** with a `cache_control` breakpoint after the system prompt + tool
  schemas. That prefix is resent every turn; caching it cuts its cost ~90%. Keep tool ordering
  deterministic (sort by name) or the cache never hits.
- Set `output_config: { effort: ... }` explicitly and sweep it during phase 1 — it is the
  primary cost/latency lever after tool-result size.

### 1d. Persistence

New Prisma models in `apps/api/prisma/schema.prisma` (+ migration):

- `AssistantConversation` — tenant, user, title, timestamps
- `AssistantTurn` — role, content, token usage, model id, latency
- `AssistantToolCall` — turn, tool name, input, result summary, duration, **allowed/denied**
- `AssistantPromptVersion` — tenant, version, system prompt, glossary, author, publishedAt

`AssistantPromptVersion` is versioned with publish/rollback, mirroring the existing integration-config
pattern. A flat KV store (the workflow configs table) was considered and rejected: it can't express
version history or link an eval run to the prompt version that produced it.

### 1e. Assistant Lab (ops admin's authoring surface)

New route `/assistant-lab` in `apps/tenant-web/src/router.tsx`, gated
`beforeLoad: requireRole('operations_admin', 'tenant_admin')`.

> **Not under `/settings/*`.** `settingsLayout` wraps every settings route with
> `requireRole('tenant_admin')` — an operations admin would never see it there.

Four panes:

1. **Prompt editor** — system prompt + domain glossary, save-as-new-version, publish, rollback.
2. **Chat** — runs as the logged-in user's real principal, so scoping is authentic.
3. **Trace viewer** — per turn: which tools were offered, which were called with what arguments,
   what came back, how long, how many tokens, what it cost. Reads `AssistantToolCall`.
4. **Eval runner** — replays `ops-baseline.json` against the current draft prompt, diffs pass/fail
   against the last published version. This is what makes prompt iteration a measured loop rather
   than vibes, and it is the single highest-value pane. Do not defer it.

---

## Phase 2 — Chat UI for gated roles

- A slide-over panel (`components/ui/sheet`, shadcn primitives already in `src/components/ui/`)
  reachable from `AppShell.tsx`, shown only when `usePermissions().has('assistant:use')`.
- **Seed each conversation with page context** — the shipment or trip currently on screen. "Why
  is this one late?" without re-stating which one is the whole difference between a novelty and
  a tool people use.
- Streaming render via the `streamFetch` reader; show tool activity inline ("Looking up trip
  4471…") so a 15-second answer reads as progress rather than a hang.
- Widen `UseAssistant` to the dispatch and coordinator personas once the eval set passes on
  their role scoping specifically — a driver's tool list is much smaller, and the prompt must
  degrade gracefully when a tool it wants isn't there.

---

## Phase 3 — GA

- Grant `UseAssistant` across the remaining personas in `authz/policies/30-personas/`.
- **Confirm the concurrency increase landed** and reserved concurrency is set. Blocking.
- Per-tenant monthly token budget + a kill switch (an env-gated `ASSISTANT_ENABLED`, following
  `INTEGRATION_CONFIG_PUBLISH_ENABLED` in `apps/api/src/lib/integration-config-feature.ts`).
- CloudWatch dashboard: turns/day, p50 and p95 latency, tool-call error rate, spend/tenant.
- Re-run the eval set on `claude-sonnet-5` and step down if it holds — that decision is now
  evidence-backed rather than a guess.

---

## Critical files

**New:** `apps/api/src/assistant/{provider,loop,prompt}.ts`, `apps/api/src/assistant/tools/*`,
`apps/api/src/lambda-assistant.ts`, `apps/tenant-web/src/routes/assistant-lab.tsx`,
`apps/tenant-web/src/features/assistant/*`

**Modified:** `apps/api/src/authz/actions.ts`, `authz/policies/30-personas/{operations-admin,tenant-admin}.cedar`,
`apps/api/prisma/schema.prisma`, `apps/api/src/middleware/tenant.ts` (extract the token-verify
helper), `packages/api-http/src/index.ts` (add `streamFetch`), `packages/infra/lib/stacks/api-stack.ts`
(new `NodejsFunction` + Function URL + reserved concurrency + Bedrock/Claude-on-AWS IAM grant),
`apps/tenant-web/src/router.tsx`, `apps/tenant-web/src/components/AppShell.tsx`

**Reused, not rebuilt:** `apps/api/src/lib/authz.ts` (`authorize`, `listAllowedPermissions`),
`apps/api/src/middleware/rbac.ts`, `apps/api/src/repositories/*`, `apps/api/src/handlers/me.ts`,
`apps/tenant-web/src/auth/{permissions,role-guard}.ts`, `src/components/ui/*`

---

## Verification

1. **Unit** (`packages/domain` conventions, vitest): tool-registry filtering — given a principal
   with role `driver`, assert `list_invoices` is absent from the offered tool list; given
   `operations_admin`, assert it is present.
2. **Integration** (`apps/api`, needs Docker Postgres): call each tool's `run` directly with a
   principal lacking its action and assert it throws — proving the second `authorize()` is load-bearing
   and not decorative.
3. **The eval set is the real gate.** `npm run assistant:eval` replays `ops-baseline.json` and
   reports pass rate, mean tool calls per question, and mean cost per question. Phase 1 exits when
   the ops admin's baseline passes; every prompt change is judged against it.
4. **Manual, and do this early:** log in as an `operations_admin`, ask "which trips are running
   late this week?", and read the trace pane. Confirm the tools called are the ones you'd have
   picked, and that the row counts returned are small. Then log in as a `driver` and ask a
   billing question — the correct behavior is a graceful "I don't have access to that," produced
   because the tool was never offered, not because the model declined.
5. **Browser** (`apps/tenant-web`): use the `apps/tenant-web:verify` skill to drive the real SPA
   and confirm the streaming reader renders incrementally.
6. **Cost check before phase 2:** confirm `usage.cache_read_input_tokens` is non-zero across
   consecutive turns. If it's zero, a silent cache invalidator is in the prefix (a timestamp in
   the system prompt, non-deterministic tool ordering) and every turn is paying full price.

---

## Open items

- [ ] **AWS Lambda concurrency limit increase — open the request now.** Gates phase 3.
- [ ] Confirm tenant-PII-to-inference-provider posture, and whether any tenant contract excludes it.
- [ ] Claude Platform on AWS workspace provisioning + Marketplace billing enablement.
- [ ] Ops manager's Claude Code seat.
