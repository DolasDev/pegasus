# AI Chat Assistant — role-scoped Q&A over the Pegasus API

> ## ▶ PHASE 1 BUILT 2026-11-10 — branch `feat/ai-chat-assistant`, deployed DARK
>
> Implemented on that branch, then **parked back in `plans/todo/`** when it merged: Phases
> 2–3 are not started, and the next step (below) is an AWS action, not code. Move it to
> `plans/in-progress/` when someone picks it up again. Everything below Phase 1 in
> this file still stands except where the "Phase 1 — as built" section says otherwise.
> **Read that section first**; it records the decisions taken while building and every
> place the build departs from the text below.
>
> **Off until a person does two AWS things per account** (`assistantEnabled = false` in
> `packages/infra/bin/app.ts`): submit the Bedrock Anthropic use-case form, then verify
> one `InvokeModel` against `us.anthropic.claude-opus-5`. The function, Function URL,
> grant and tables all deploy; every `/api/v1/assistant` route answers 404 until the
> flag flips.

> ## ⏸ (history) PAUSED 2026-09-28 — parked in `plans/todo/`
>
> **Phase 0 shipped** 2026-08-21 (#651, #652). Phases 1–3 are **not started**: no
> assistant code, no infrastructure, no AWS account provisioning. The only thing on
> `main` is Phase 0's eval scaffold, which nothing imports at runtime.
>
> **Why paused, not abandoned:** nothing here failed. Phase 1 needs an input that did
> not arrive: the ops admin's eval set (still the three placeholder cases, five weeks
> on). That's someone else's clock.
>
> **CORRECTION 2026-10-30: the Lambda quota was never a blocker.** Both AWS accounts
> (prod `331145994639`, staging `248812875460`) were raised to **1,000** concurrent
> executions on **2026-05-29**. Service Quotas history shows both requests approved and
> CASE_CLOSED within 47 minutes. `get-account-settings` on 2026-10-30 shows 1,000 total,
> all unreserved. The 2026-09-18 "both accounts are at 10" below was taken from a stale
> note, not checked live. The struck-through quota items are kept below as history.
>
> **To resume, in this order:**
>
> 1. ~~**Request the Lambda concurrency increase.**~~ Done since 2026-05-29 (see the
>    correction above). Reserved concurrency is settable now.
> 2. **Get the eval set authored** (Phase 0 step 4). Gates Phase 1's prompt work.
> 3. **Answer the two remaining infra unknowns** in "Infrastructure" (§3 Function URL exposure,
>    §4 sizing and the kill switch) before writing CDK. §2 was settled 2026-11-07: the host is Bedrock.
> 4. Then Phase 1.
>
> **Read "Infrastructure — designed on paper only" before writing any code.** The
> original plan's one-line infra sketch was optimistic; the section below records what
> was verified since, including one item that makes the plan-as-written undeployable.

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

| Decision          | Choice                                                                                                                       | Why                                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retrieval         | Tool-use over existing read endpoints                                                                                        | Inherits Cedar role scoping; never stale                                                                                                                              |
| Inference host    | **Claude in Amazon Bedrock** (AWS-operated, SigV4) — _changed 2026-11-07 from Claude Platform on AWS; see Infrastructure §2_ | No API key — the Lambda role authenticates. AWS is the sole data processor (settles the phase-2 PII assumption). Everything but a one-time use-case form is CDK.      |
| Model             | **`claude-opus-5`** via `us.anthropic.claude-opus-5`                                                                         | Removes model quality as a variable while ops tunes context. Re-evaluate against the eval set at GA; the seam below makes the swap cheap.                             |
| Provider coupling | Thin `InferenceProvider` seam                                                                                                | Tool registry, Cedar filtering, traces, prompt store are all provider-agnostic. Switching providers = one adapter file + one env var.                                 |
| Transport         | Dedicated Lambda + Function URL, `RESPONSE_STREAM`                                                                           | See "The 29-second problem" below.                                                                                                                                    |
| Rollout gating    | **New Cedar action, not a capability flag**                                                                                  | `usePermissions().hasCapability()` in `apps/tenant-web/src/auth/permissions.ts` **fails open** (absent ⇒ `true`). A Cedar action fails closed and is server-enforced. |
| v1 tool surface   | **Read-only**                                                                                                                | No mutations. The model's output must never drive a state change.                                                                                                     |
| Persistence       | Conversations + per-tool-call traces from day 1                                                                              | The trace table _is_ the lab's debugger, the audit log, and the eval substrate.                                                                                       |

### Assumptions (flagged, proceeding)

- ~~**Tenant PII leaves our infrastructure.**~~ **Largely settled 2026-11-07 by the switch to
  Bedrock** (Infrastructure §2). AWS is the sole data processor, and the `us.*` geo profile keeps
  inference in US regions. Customer names, addresses and shipment details still go to the model
  as tool results inside our AWS accounts. So still confirm that no tenant contract forbids LLM
  processing at all before phase 2 exposes it beyond internal staff. If a tenant must be excluded,
  the Cedar action is the per-tenant off switch.
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
>
> **CORRECTION (2026-09-18): the last sentence is wrong — it gates phase 1's infra.** See
> below.
>
> **CORRECTION (2026-10-30): the whole callout is moot.** Both accounts have been at 1,000
> since 2026-05-29, so there is no limit-increase request to open. Setting **reserved
> concurrency** on the assistant function still stands, and is possible now. See section 1.

---

## Infrastructure — designed on paper only

Verified 2026-09-18 against `packages/infra`: **zero** hits for bedrock, anthropic, claude,
`FunctionUrl`, `RESPONSE_STREAM` or `reservedConcurren*`. The entire infra design is the single
"Critical files" bullet about `api-stack.ts`. Per this repo's own rule — a feature is not shipped
until it is wired into CDK — the LLM backend does not exist in any form.

Four things were established after the plan was written. The first (based on a stale quota
figure) and the second (resolved 2026-11-07 by switching to Bedrock) are no longer blocking. Items 3
and 4 are still open.

### 1. ~~Reserved concurrency CANNOT be set at the current quota — this is now a phase-1 blocker~~ RESOLVED: the quota is 1,000

> **CORRECTION (2026-10-30).** The premise below was wrong when it was written. Both accounts
> were raised to **1,000** on 2026-05-29 (Service Quotas request `L-B99A9384`, CASE_CLOSED), so
> on 2026-09-18 they were already at 1,000, not 10. The AWS rule itself is right: reservations
> may total at most _unreserved minus 100_. At 1,000 that allows up to **900**, so
> `reservedConcurrentExecutions` on the assistant function is settable, and the
> no-starvation protection is available from phase 1. Size the reservation in phase 1 (for
> example 50) and leave the rest for the platform. The original text follows as history.

AWS only permits reserving up to **unreserved account concurrency minus 100**; the last 100 units
must stay unreserved. Both accounts are capped at **10**, so the reservable amount is negative:
`reservedConcurrentExecutions` cannot be set at any value and a CDK deploy specifying it **fails
outright**.

So the quota increase is not a GA checkbox — it is a prerequisite for the infra being _writable_.
And until it lands, the protection this whole design leans on (held streaming connections cannot
starve the platform API) is unavailable at **any** value: ten concurrent chats consume the entire
account pool. Land somewhere ≥ 500 so reserving a meaningful slice is possible at all.
Refs: [AWS docs](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html),
[re:Post](https://repost.aws/questions/QU7NV9YgI3RGaqVOFdrZYnSQ/concurrency-limits-for-lambda-does-not-allow-to-reserve).

### 2. ~~Claude Platform on AWS provisioning is not IaC, and the IAM grant is unpinned~~ RESOLVED: switch the host to Amazon Bedrock

> **DECIDED 2026-11-07: the inference host is Claude in Amazon Bedrock, not Claude Platform on
> AWS.** Web research against primary docs (sources below) settled both halves of the old item.
> Bedrock is CDK apart from one CLI call per account, and its IAM grant is pinned to named
> actions from the AWS Service Authorization Reference. The deciding factor is the data
> posture, not CDK. Bedrock makes AWS the **sole data processor**, which largely settles the phase-2
> "tenant PII leaves our infrastructure" assumption. Anthropic's own Claude
> Platform on AWS page says to use Bedrock "if you need AWS as the sole data processor". The
> original text and the rejected alternative are kept below as history.

**What the design now commits to:**

| Concern            | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model id           | **`us.anthropic.claude-opus-5`**, the US geo cross-region inference profile. From `us-east-1` it routes only to us-east-1, us-east-2 and us-west-2. **Never `global.*`**, which routes worldwide and gives back the residency the switch was for. Opus 5 has no in-region `bedrock-runtime` endpoint, so a geo profile is required.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Client             | **`AnthropicBedrock` from `@anthropic-ai/bedrock-sdk`**, the default client. **Not** the `mantle-client` export and **not** the `bedrock-runtime…/anthropic` Messages path, because neither appears in the Service Authorization Reference (see the grant row). The default client calls `/model/{id}/invoke` and `/model/{id}/invoke-with-response-stream` (verified in the 1.1.1 tarball, `client.js`), with the same Messages-shaped request and response and the same tool runner.                                                                                                                                                                                                                                              |
| Credentials        | SigV4 from the Lambda execution role. There is no API key anywhere, so `bedrock:CallWithBearerToken` is **not** granted. Bedrock long-term API keys stay unused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| IAM grant (pinned) | `bedrock:InvokeModel` + `bedrock:InvokeModelWithResponseStream`. The Service Authorization Reference maps the `InvokeModel` and `InvokeModelWithResponseStream` operations to exactly these actions. The `Converse*` operations reuse the same two. **Resources:** (a) the inference profile `arn:aws:bedrock:us-east-1:{account}:inference-profile/us.anthropic.claude-opus-5`, **and** (b) the foundation model in **every destination region** `arn:aws:bedrock:{us-east-1,us-east-2,us-west-2}::foundation-model/anthropic.claude-opus-5`. A grant on the profile alone does not cover the underlying model. Add `bedrock:CountTokens` only if the adapter calls it. Opus 5 on `bedrock-runtime` does not support count-tokens. |
| Cost attribution   | An **application inference profile** (`CfnApplicationInferenceProfile`, stable L1 in the installed `aws-cdk-lib` 2.273.0) wrapping the US geo profile, tagged `feature=assistant` (later `feature=workflows-llm`). The grant then targets the application-profile ARN **plus** the underlying model ARNs as above. Skip the experimental `@aws-cdk/aws-bedrock-alpha` L2. Optional for phase 1, cheap to add.                                                                                                                                                                                                                                                                                                                       |
| Kill switch        | Removing the grant (or deploying a `Deny`) is the infra-level lever. It sits alongside the `ASSISTANT_ENABLED` env flag from §4, and both must be in CDK.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**The one non-IaC step: the Anthropic use-case form.** Bedrock has enabled all serverless
models by default since 2025-10-15, governed by IAM with no model-access page. Anthropic models
are the exception: they need a one-time **use-case form per AWS account**
(`aws bedrock put-use-case-for-model-access`, base64 form-data on the CLI). If you submit it from
an AWS Organizations **management** account, it covers the child accounts. Before the first
invoke, a missing form surfaces as a `ResourceNotFoundException`. Approval can take ~15 minutes.

- Do this as a **documented runbook step, not a CDK custom resource**. It runs once, needs
  company and use-case text, and isn't a deploy-time concern.
- **Check first:** are prod `331145994639` and staging `248812875460` in one Organization, and
  can this team act as its management account? If yes, one call covers both. If not, make one
  call per account.
- **Verify** with a single `InvokeModel` from each account's role (or the CLI) before phase 1's
  CDK lands, so a missing form isn't mistaken for an IAM bug.

**What Bedrock costs us vs. Claude Platform on AWS:** feature lag. New models and features may
land later than on the first-party API. Opus 5's `bedrock-runtime` support covers everything
phase 1 uses: streaming, tool use, adaptive thinking, explicit prompt caching (4 checkpoints,
5 min / 1 h TTL) and structured outputs. Anthropic-hosted extras are missing, such as Agent
Skills, the code-execution sandbox, the Files API and count-tokens. The plan uses none of them.
The `InferenceProvider` seam keeps a later swap to one adapter file.

**Rejected alternative: Claude Platform on AWS.** It was the original choice. Kept for the record,
because its blockers turned out to be smaller than the old text claimed:

- The IAM grant **is** pinnable: `aws-external-anthropic:CreateInference` on
  `arn:aws:aws-external-anthropic:{region}:{account}:workspace/wrkspc_…`, plus
  `sts:GetWebIdentityToken` / `sts:TagGetWebIdentityToken`, conditioned on
  `aws:CalledViaLast = aws-external-anthropic.amazonaws.com` and the Anthropic audiences.
- `iam:EnableOutboundWebIdentityFederation` is a plain IAM API call. It returns a 409 on repeat
  and has no CloudFormation type. Workspaces come from a SigV4 admin route
  (`POST /v1/organizations/workspaces`). Both would need Lambda-backed custom resources, because
  `AwsCustomResource` can't call a non-AWS-SDK endpoint.
- **Still console-only:** Marketplace signup and Anthropic organization creation, which is tied to
  an owner email, once per account. There's no CloudFormation resource type. Terraform support
  exists only as unmerged pull requests in a community provider.
- **Data posture:** Anthropic is the processor, ZDR is on request only, and workspaces created
  before 2026-09-18 may store data outside AWS. Its advantage is same-day feature parity, which
  this design doesn't need.

**Sources:** [Bedrock model card: Claude Opus 5](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5.html),
[Service Authorization Reference: Bedrock](https://docs.aws.amazon.com/service-authorization/latest/reference/list_bedrock.html),
[PutUseCaseForModelAccess](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_PutUseCaseForModelAccess.html),
[Bedrock automatic model enablement](https://aws.amazon.com/about-aws/whats-new/2025/10/amazon-bedrock-automatic-enablement-serverless-foundation-models),
[CDK InferenceProfileBase (grant semantics)](https://docs.aws.amazon.com/cdk/api/v2/docs/@aws-cdk_aws-bedrock-alpha.InferenceProfileBase.html),
[Claude Platform on AWS](https://platform.claude.com/docs/en/build-with-claude/claude-platform-on-aws),
[Claude Platform on AWS IAM actions](https://platform.claude.com/docs/en/api/claude-platform-on-aws-iam-actions).

<details><summary>Original text (2026-09-18), superseded</summary>

Workspace provisioning and AWS Marketplace billing are console/account actions CDK cannot express —
a manual prerequisite before any IAM grant means anything. And the plan asserts "SigV4 from the
Lambda role" **without pinning which IAM actions and resources**. Bedrock's
`bedrock:InvokeModelWithResponseStream` on a model ARN is a _different_ grant from
Anthropic-operated Claude Platform on AWS. The grant cannot be written until the account is
provisioned and the real auth surface is observed. Do not guess it into CDK.

</details>

### 3. A Function URL with custom JWT auth is internet-exposed — undecided

Verifying the Cognito token in-function means `authType: NONE`: a public endpoint outside API
Gateway and whatever the CDN stack fronts. The plan covers CORS and never addresses the exposure
itself. Decide deliberately before writing it.

### 4. Smaller, but each has bitten this repo before

- **Bundling.** `NodejsFunction` bundles CJS, and an ESM-only dependency once caused a silent
  Lambda INIT crash that ran undetected for two months with synth and deploy both green
  (`project_lambda_esm_bundling_init_crash`). **Checked 2026-11-07:** `@anthropic-ai/bedrock-sdk`
  1.1.1 is `"type": "commonjs"` with a CJS `require` export, and every direct dependency is CJS
  (`@anthropic-ai/sdk`, `@aws-sdk/*`, `@smithy/*`, `@opentelemetry/api`). The shape check passes.
  Still smoke-invoke the deployed function, because synth and deploy were green last time too.
- **The kill switch is not real until it is in CDK.** `ASSISTANT_ENABLED` is listed under phase 3,
  but an env flag absent from `packages/infra` is not a lever — the exact trap the
  flag-gated-feature rule exists for.
- **Unspecified:** timeout and memory for a streaming function (billed on wall-clock, not compute),
  and any infra-level spend alarm. The per-tenant budget in phase 3 is application-level only.

### Placement decision — make this before phase 1 writes a line

The "Critical files" list puts the adapter at `apps/api/src/assistant/provider.ts`. **Put it
somewhere neutral instead** — `apps/api/src/lib/inference/` or its own package — and let
`assistant/` be one consumer among others. See "Phase 4" below: a second consumer is already
foreseeable, and burying the adapter inside the assistant feature forces either a cross-feature
import or a reimplementation. Five minutes now; a refactor under pressure later.

---

## Phase 0 — Ops-admin enablement (near-zero engineering, start today)

> **Status: SHIPPED 2026-08-21** (#651 `2dec87fa`, #652 `30009f40`). Delivered: the
> onboarding doc `docs/ai-assistant-ops-admin-onboarding.md`, and the eval-set
> scaffold `apps/api/src/assistant/evals/` (zod schema + CI-enforced validation +
> authoring README + `ops-baseline.json` with three worked examples).
>
> **Still owed by people, not code** — unchanged as of 2026-09-28: mint the key
> (step 1), the ops manager's Claude Code seat (step 3), and the eval set itself
> (step 4). `ops-baseline.json` still holds only the three worked examples, so
> **Phase 1's acceptance gate does not yet exist.**
>
> If authoring stalls on Git friction rather than on the questions themselves, a
> simple upload path is a small piece of work and removes the only real barrier.

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

- `provider.ts` — the `InferenceProvider` seam (but see "Placement decision": it belongs in
  `apps/api/src/lib/inference/`). `BedrockProvider` uses `AnthropicBedrock` from
  `@anthropic-ai/bedrock-sdk` (the default client, not `mantle-client`). Region and model id
  (`us.anthropic.claude-opus-5`) come from env, with SigV4 from the Lambda role. See
  Infrastructure §2 for the pinned grant.
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

### Phase 1 — as built (2026-11-10, `feat/ai-chat-assistant`)

Decisions taken with the user while building, and every departure from the text above:

- **Tools call the existing endpoints in-process, not the repository layer** (1b said
  repositories). The headline Operations reads (`shipments-list`, `trips-list`,
  `trip-detail`, `drivers`) are Hono handlers that query on-prem MSSQL through the executor
  Lambda; there is no repository to call. Each tool builds a path, the loop runs it with
  `app.fetch` carrying the caller's own `Authorization` header, and the endpoint
  authenticates, scopes and queries exactly as it does for the browser. Nothing is
  re-implemented and new read endpoints are tool-eligible with one registry entry.
  Consequence: the assistant Lambda needs the API's reach, so it **shares the API Lambda's
  role and env** (`addApiEnvironment()` in `api-stack.ts`; a test pins zero drift).
- **§3 decided: public Function URL** (`authType: NONE`, `RESPONSE_STREAM`). The HTTP API
  already has no gateway authorizer, so in-function JWT auth is the existing posture.
  `lambda-assistant.ts` serves only `/api/v1/assistant/*` (pinned by a test), so the URL
  can't reach the rest of the API around the stage throttle; reserved concurrency **50**
  caps the blast radius.
- **No token-verify extraction.** The assistant router is mounted on `v1`, so it inherits
  `tenantMiddleware` untouched; the streaming Lambda serves the same app with
  `streamHandle`. "Modified: `middleware/tenant.ts`" in Critical files did not happen.
- **Two gates per tool, and they differ by surface.** Longhaul Operations tools gate on
  `OPERATIONS_ROLES` (that surface is not Cedar anywhere; see `lib/longhaul-read-scope.ts`).
  Entity tools gate on their Cedar read action. That gate is **load-bearing**, not just
  defense in depth: `GET /customers`, `/quotes` and `/invoices` on v1 carry no
  `requirePermission` at all (a separate pre-existing gap, not fixed here).
- **operations_admin's grant lives in `policies/60-assistant.cedar`**, not in the
  `30-personas/operations-admin.cedar` placeholder (which stays comment-only by design). The
  placeholder-persona invariant test moved to `coordinator`; a new test pins
  operations_admin to the shared baseline plus exactly the two assistant actions.
- **Verification 1 corrected:** operations_admin is NOT offered `list_invoices`. Its Cedar
  persona grants no entity reads, so it gets the four Operations tools only. The registry
  test asserts that, and uses accountant / tenant_admin for the invoice case.
- **SDK gotcha (fixed, pinned):** `@anthropic-ai/sdk` 1.8's tool runner defaults to
  server-held message threads. Later rounds then carry only the new `tool_result` plus
  `previous_message_id`, with no system prompt, tools or history. Bedrock can't continue
  such a thread. The loop passes `thread: false`; `loop.test.ts` asserts every round is a
  complete request.
- **Eval grading is deterministic** (`mustInclude` / `mustNotInclude`, case-insensitive). A
  case with neither is `ungraded` and never counts toward the pass rate. The tool OFFER is
  the case's `askedAs` role, but lookups run as the Lab user. Nothing lets a request claim
  another role, so endpoint-level row scoping (a driver's own moves) reflects the Lab
  user. Cost is reported as tokens; there's no price table in code.
- **Kill switch is real now** (§4): `ApiStackProps.assistantEnabled` → `ASSISTANT_ENABLED`
  on both Lambdas. `/me/permissions` reports `capabilities.assistant`, and the nav entry
  needs that capability plus `assistant:use`.
- **Not built in phase 1:** `CfnApplicationInferenceProfile` (optional per §2), a spend
  alarm, and an infra-level per-tenant budget (phase 3).

Files: `apps/api/src/assistant/{http,loop,prompt}.ts`, `assistant/tools/*`,
`assistant/evals/runner.ts`, `lib/inference/{provider,fake}.ts`, `lib/assistant-feature.ts`,
`repositories/assistant.repository.ts`, `lambda-assistant.ts`,
`scripts/assistant-eval.ts` (`npm run assistant:eval` in `apps/api`), migration
`20261110214645_assistant_persistence`, `packages/api-http` (`createStreamClient`),
`apps/tenant-web/src/routes/assistant-lab.tsx` + `features/assistant/*`, infra in
`api-stack.ts` / `frontend-assets-stack.ts` / `frontend-stack.ts` / `bin/app.ts`.

**Still owed before phase 1 can exit** (its exit is "the ops admin's baseline passes"):

1. Per account (staging first): the Bedrock use-case form, then one verified `InvokeModel`.
   Check first whether prod and staging share an Organization.
2. **Right after this merges, before any AWS step:** `curl` the staging Function URL
   (`AssistantUrlExport` output) at `/api/v1/assistant/tools`. It should answer **401**
   (no token) or **404 `ASSISTANT_DISABLED`**. A **502** means the Lambda failed INIT, the
   #594 class that synth, deploy and the bundle test all miss. (`@aws-sdk/*` stays external
   and resolves from the runtime; the Bedrock SDK is imported lazily so it can't take the
   main API's INIT down, but the assistant entry still loads the whole app.)
3. Flip `assistantEnabled` for staging and deploy. Then, **from the SPA in a browser**
   (not curl):
   - exactly one `Access-Control-Allow-Origin` on the Function URL response. The Function
     URL's CORS and Hono's `cors()` could both set it.
   - Bedrock accepts `output_config.effort` and the runner's `type: "custom"` tool entries
     on the invoke path.
   - `cache_read_input_tokens > 0` on a second turn (Verification 6).
   - no `stop_reason: max_tokens` in the traces. Adaptive thinking is on by default and
     shares the 4,096-token ceiling, so raise `maxTokens` if it shows up.
4. The eval set: still three placeholders, so the gate content doesn't exist yet. The
   runner, the Lab pane and `npm run assistant:eval` are ready for it.
5. Manual checks (Verification 4/5): operations_admin asks "which trips are running late
   this week?" and reads the trace; a driver-only login can't reach the Lab at all.

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
- ~~**Confirm the concurrency increase landed**~~ (at 1,000 since 2026-05-29). **Confirm reserved concurrency is set** on the assistant function. Blocking.
- Per-tenant monthly token budget + a kill switch (an env-gated `ASSISTANT_ENABLED`, following
  `INTEGRATION_CONFIG_PUBLISH_ENABLED` in `apps/api/src/lib/integration-config-feature.ts`).
- CloudWatch dashboard: turns/day, p50 and p95 latency, tool-call error rate, spend/tenant.
- Re-run the eval set on `claude-sonnet-5` and step down if it holds — that decision is now
  evidence-backed rather than a guess.

---

## Phase 4 (sketch, 2026-09-25) — LLM calls from inside workflows

Not committed to; recorded so phase 1 does not foreclose it. Question asked: could this backend
also be the foundation for using LLMs from within tenant-authored workflows? **Yes — but the reuse
is concentrated in the slow, expensive parts and is near-zero in the visible ones.**

**Carries over (the long-lead items):** the Bedrock Anthropic use-case form (one-time,
account-level, Infrastructure §2); the SigV4-from-execution-role credential model — same grant shape for a
Temporal worker task role as for a Lambda; the `InferenceProvider` seam (model ids, region,
retries, throttling, token accounting). (The Lambda quota increase was listed here; it was already
at 1,000 since 2026-05-29.) Most of the pain, done once.

**Does NOT carry over:**

- **Streaming.** Function URL + `RESPONSE_STREAM` exists so a _browser_ paints tokens
  progressively. A workflow has no human watching a spinner and wants request/response.
- **Cedar per-user tool filtering — the assistant's entire premise.** Tools are filtered by the
  _human caller's_ role. A workflow runs as `workflow_runtime`, a service account. The model is not
  merely unused here, it is the wrong shape: workflow capability is governed by the manifest's
  `required_actions`, a different mechanism that already exists.
- The Assistant Lab, conversation/turn persistence, and the DB-backed prompt store. A workflow's
  prompt belongs in its own source, versioned with its artifact.

**The structural fact is a language boundary.** This backend is TypeScript on Lambda; workflows are
Python, sandboxed, on Temporal workers. A workflow cannot import the provider — it reaches it over
HTTP, exactly as every other workflow capability does. **`send_sms` is the template**
(`packages/workflows-sdk-python/pegasus_workflows/api.py:851`): SDK method → POST to an **m2m**
endpoint on the runtime `vnd_` key, gated by a Cedar action (`SendSms`) _and_ by the manifest
declaring `required_actions`, with dry-run capture via `_capture_mutation` so
`pegasus-workflows test` does not fire for real. Its docstring already states the constraint an LLM
call needs anyway — **"for use inside workflow activities only, never in workflow code"** — because
a non-deterministic call cannot live in Temporal workflow code. Inherited, not invented.

So the shape is fully determined by precedent: a new Cedar action, one m2m endpoint over the
**shared** adapter, an SDK method, a manifest declaration, dry-run capture — plus the CLAUDE.md
discoverability tax (SDK README, the authoring repo's `CLAUDE.md`, MCP resources, CLI `--help`,
OpenAPI). A capability not reachable through the SDK is a gap, not a feature.

**Two asymmetries that bite workflows harder than chat:**

- **Cost governance is day-one here, not phase 3.** Chat's caller is a human typing, self-limiting
  at ~30 turns/hour. A workflow's caller is arbitrary tenant-authored code that can loop an LLM
  call ten thousand times. A per-execution token budget and per-tenant cap are the _first_ thing to
  build, not the last.
- **Activity retries cost money.** A slow call that trips an activity timeout and retries bills
  twice for one logical call. Retry policy and idempotency need deliberate thought.

---

## Critical files

> **Superseded in one place:** `provider.ts` moves OUT of `assistant/` to a neutral location —
> see "Placement decision" under Infrastructure. The rest of this list stands.

**New:** `apps/api/src/assistant/{provider,loop,prompt}.ts`, `apps/api/src/assistant/tools/*`,
`apps/api/src/lambda-assistant.ts`, `apps/tenant-web/src/routes/assistant-lab.tsx`,
`apps/tenant-web/src/features/assistant/*`

**Modified:** `apps/api/src/authz/actions.ts`, `authz/policies/30-personas/{operations-admin,tenant-admin}.cedar`,
`apps/api/prisma/schema.prisma`, `apps/api/src/middleware/tenant.ts` (extract the token-verify
helper), `packages/api-http/src/index.ts` (add `streamFetch`), `packages/infra/lib/stacks/api-stack.ts`
(new `NodejsFunction` + Function URL + reserved concurrency + the pinned Bedrock IAM grant from Infrastructure §2, optionally a
`CfnApplicationInferenceProfile`),
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

Ordered by what unblocks what. The first three are the resume checklist from the header.

- [x] ~~**AWS Lambda concurrency limit increase.**~~ Done 2026-05-29: both accounts are at 1,000,
      CASE_CLOSED (found on 2026-10-30). The "unsettable at a quota of 10" reasoning was based on a
      stale figure.
- [ ] **The eval set** (Phase 0 step 4) — still three placeholder cases. Gates phase 1's prompt
      work.
- [x] ~~**Decide the Function URL exposure**~~ Decided 2026-11-10: public `authType: NONE`
      with in-function auth, assistant-prefix-only entry and reserved concurrency 50 (see
      "Phase 1 — as built").
- [ ] **Smoke-invoke the deployed assistant Function URL** once `assistantEnabled` is on for
      staging. Includes the cache-read check and Bedrock accepting the runner's tool entries.
- [x] ~~Claude Platform on AWS workspace provisioning + Marketplace billing.~~ Superseded
      2026-11-07: the host is now Bedrock, and the grant is pinned (Infrastructure §2).
- [ ] **Submit the Bedrock Anthropic use-case form** (`put-use-case-for-model-access`). First
      check whether prod and staging share an Organization, because one management-account call
      covers both. Then verify with one `InvokeModel` per account.
- [ ] Confirm no tenant contract excludes LLM processing of its data. With Bedrock, data stays
      in our AWS accounts and US regions. Blocks phase 2, not phase 1.
- [ ] Ops manager's Claude Code seat.
- [x] ~~Check the SDK for the ESM/CJS bundling trap.~~ `@anthropic-ai/bedrock-sdk` 1.1.1 and its
      direct dependencies are all CJS (2026-11-07). Smoke-invoke after the first deploy anyway.
