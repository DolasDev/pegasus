# AI Chat Assistant — move inference to the Bedrock Converse API

**Branch:** `feat/assistant-converse` (worktree `../pegasus-assistant-converse`). This branch is **PR 1** below; PR 2 and PR 3 get their own branches.
**Goal:** the assistant's model becomes a configuration choice among the Bedrock models we allow, not a code change. It stays on Amazon Bedrock, so AWS remains the only data processor.

**Status:** approved and started 2026-11-21 (Steve ran `/workstream-start`). It builds on Phase 1 of
`plans/todo/ai-chat-assistant.md` (merged in #948 and deployed dark). Read that plan's "Phase 1 — as built" section first.

**The prerequisites below no longer block writing code**: Steve chose to start before them. They still gate **G1/G2 (step 10)**. PR 1 is safe to merge before them because the assistant deploys dark (`assistantEnabled = false`), but the switch to Converse isn't _proven_ until V1–V4 and the baseline comparison run in staging.

**Origin:** Steve, 2026-11-20. Submit the Anthropic use-case form, test the assistant on
Claude, _then_ consider Converse, so that the model can be swapped and tuned later.
Leaving Bedrock is out of scope.

---

## Prerequisites — in this order, none of them code

Each item is a hard gate. Without a baseline on today's path, there is nothing to say whether Converse made things worse.

1. **The Bedrock Anthropic use-case form is submitted**, per account or once at the Organization's management account. Then one admin-run call:
   `aws bedrock-runtime converse --region us-east-1 --model-id us.anthropic.claude-opus-5 --messages '[{"role":"user","content":[{"text":"Reply with ok"}]}]'`
   That one call proves account access _and_ that Converse serves this profile.
2. **Staging works on today's InvokeModel path:**
   - The Function URL curl returns 401 or 404.
   - `assistantEnabled` is flipped for staging.
   - The browser checks in the parent plan's "Still owed" item 3 pass.
3. **The eval set is authored**: 20–30 real ops questions in
   `apps/api/src/assistant/evals/ops-baseline.json` (still 3 placeholders today). Run it
   on today's path and **record the baseline in this file**: pass rate, mean tokens
   (input, output, cache read), mean rounds and p50/p95 latency.

## Verified facts this plan rests on (checked 2026-11-20 against AWS docs)

- **IAM.** "To call `Converse`, you require permission for the `bedrock:InvokeModel`
  operation. To call `ConverseStream`, you require permission for the
  `bedrock:InvokeModelWithResponseStream` operation." (Bedrock user guide, _Inference
  using Converse API_.)
  - Those are exactly the two actions pinned in `api-stack.ts` (`AssistantBedrockInvoke`).
  - The Service Authorization Reference's operation table also lists `ApplyGuardrail`, `CallWithBearerToken` and `InvokeTool` for ConverseStream. Those apply only with guardrails, API keys and server tools respectively, and we use none of them. Don't add them. The existing test that pins no `CallWithBearerToken` stays.
- **Caching.**
  - Converse takes `cachePoint: {type: "default"}` blocks in `tools`, `system` and `messages`. They are processed in the chain `tools → system → messages`, and the minimum size counts across all three combined.
  - One `cachePoint` after the last system block therefore caches tools plus system, the same coverage as today's single `cache_control`.
  - For all Claude 5.x models: minimum 512 tokens per checkpoint, at most 4 checkpoints, TTL 5 m or 1 h (`ttl: "1h"`).
  - Nova 2 Lite accepts checkpoints in `system` and `messages` only, **not in `tools`**.
  - OpenAI GPT models on Bedrock: "Converse doesn't support explicit caching for this model."
  - Explicit caching support therefore varies by model family. See decision D4.
- **Usage semantics are unchanged.** Converse `usage.inputTokens` "represents only the
  non-cached input tokens", with `cacheReadInputTokens` / `cacheWriteInputTokens` reported
  beside it. That matches Anthropic's `input_tokens`. The four `AssistantTurn` token columns keep their meaning, with no data change.
- **Reasoning.** With thinking on, Converse returns `reasoningContent` blocks carrying a
  `signature`. "You must include the signature and all previous messages in subsequent
  `Converse` requests." That covers the tool rounds _within_ one turn.
- **Model-specific parameters** go in `additionalModelRequestFields`. AWS's own examples pass Anthropic `top_k` and top-level `cache_control` this way, so Anthropic body fields pass through.

## Corrections to what I said earlier (2026-11-20 chat)

- **Persistence is NOT in scope.** `AssistantTurn.content` stores `[{type:'text', text}]` blocks.
  - The Lab's `TracePane.tsx` and `api/assistant.ts` read that shape.
  - It is already provider-neutral in practice. Declare it the app's own format and convert to Converse `Message[]` only in `historyFromTurns`.
  - No migration and no UI change are needed.
- **"No infra change" was half true.** The _actions_ are covered, but the grant's _resources_ are pinned to the one Opus 5 profile and its foundation-model ARNs. A model swap needs the grant to take a list of models (step 6).

## Decisions

- **D1 — The seam is one model round, not an SDK client.** Today `InferenceProvider` exposes an Anthropic-shaped client, and the loop is the SDK's `toolRunner`. The new seam is a neutral `streamRound(request, signal)` that returns an async iterable of neutral events:
  - `text_delta`, `reasoning`, `tool_use` (complete, input parsed)
  - `stop {stopReason, usage}`

  The **loop is ours** (`assistant/loop.ts`), so every provider adapter only translates one round. This is also where Phase 4 (LLM calls from workflows) plugs in: a request/response caller over the same `lib/inference/` seam.

- **D2 — Two adapters behind the seam for one release, then delete one.**
  - `ConverseAdapter` is new and becomes the default.
  - `AnthropicMessagesAdapter` keeps today's InvokeModel path, rewritten to the round seam with `messages.stream` instead of `toolRunner`, so both use the same loop.
  - Select with `ASSISTANT_INFERENCE_API=converse|anthropic` (default `converse`).
  - The eval set runs both ways on the same cases. Once Converse matches (gate G2), delete the Anthropic adapter and both `@anthropic-ai/*` dependencies in a follow-up PR.
  - This is the non-breaking increment. If the A/B isn't wanted, skip straight to deleting the Anthropic adapter.
- **D3 — Hand-rolled loop replaces `toolRunner`.** It must re-implement what the runner did for us:
  - **Round limit:** `maxRounds` (default 8).
  - **Tool dispatch:** match how the SDK runner orders and parallelizes calls in one round. Check the SDK source when implementing, and pin it in a test.
  - **Input parsing:** accumulate the partial `toolUse.input` JSON and parse it once at block stop. Malformed JSON or a schema miss becomes an error tool result, never a throw.
  - **Tool errors:** `ToolError` becomes a `toolResult` with `status: 'error'`.
  - **Cancellation:** `abortSignal` on the command.
  - **Stop handling:** `max_tokens`, `guardrail_intervened`, `content_filtered` and `model_context_window_exceeded` stop the loop and are stored verbatim in `stopReason`.

  The `thread: false` gotcha disappears with the runner. Remove it from GOTCHAS, but keep the test idea: _every round is a complete request_.

- **D4 — Per-model-family profile, deliberately small.** One table in `lib/inference/models.ts`, keyed by model-id prefix (`anthropic.`, `amazon.nova`, `openai.`, `mistral.`, …). Each entry declares:
  - `cachePoints`: which of `tools` / `system` / `messages` accept a checkpoint, or none
  - `requestFields(effort)`: the `additionalModelRequestFields`. Anthropic gets `{output_config: {effort}}`; families without an effort knob get `{}`.
  - `reasoning`: whether to echo `reasoningContent` back on tool rounds

  An unknown family gets no cache points and no extra fields. It works; it just isn't tuned.

- **D5 — Thinking across turns.** Within one turn, the full assistant content, including `reasoningContent` and its signature, is replayed on every tool round. Across turns, history stays **text-only** as today. Whether Converse accepts text-only prior turns with thinking on is verification **V3**, not an assumption.
- **D6 — Cache placement for parity.** One `cachePoint` after the last system block (tools + system), only when the family allows it. No messages checkpoint in this PR. Adding one after the last tool result, to cache across rounds, is a separate measured change in the Lab.
- **D7 — Bundle `@aws-sdk/client-bedrock-runtime`; don't take the Lambda runtime's.**
  - Today `@aws-sdk/*` is external (`apiBundling.externalModules`), and the package isn't even installed locally. The current Bedrock SDK silently depends on whatever version the runtime ships.
  - Smithy clients **drop input members they don't know** without erroring. A runtime SDK older than `cachePoint.ttl`, `toolResult.status` or reasoning blocks would fail _quietly_: no cache reads, no error.
  - Add it to `apps/api` dependencies at the repo's `^3.1161.0` line, and list it under `apiBundling.nodeModules`, as `@cedar-policy/cedar-wasm` is. That installs a real copy into the asset, which takes precedence over the runtime's.
  - Keep the **lazy import** in `provider.ts`: the main API Lambda shares this bundle and must not load it at INIT (#594 class).
- **D8 — Making a model swap a config change.**
  - New `ApiStackProps.assistantModels: Array<{ profileId, foundationModelId, destinationRegions }>` with a `defaultModel`.
  - The grant covers every listed profile and its per-region foundation-model ARNs.
  - Env: `ASSISTANT_MODEL_ID` is the default, plus `ASSISTANT_ALLOWED_MODELS` (comma list).
  - The provider refuses a model outside the list and still refuses any `global.*` id.
  - The Lab's eval pane and `npm run assistant:eval -- --model <id>` may pick any allowed model. **Chat always uses the default.**
  - Changing the default is a one-line edit in `bin/app.ts` plus a deploy. Adding a model to the list is the same, plus step V5 below.
- **D9 — Fake provider at the seam, plus adapter tests** (built: `converse.test.ts` with a hand-written sequence until V1 records one, and `anthropic.test.ts` driving a real first-party client over scripted SSE).
  - The new fake implements `streamRound` from a script, so the loop and HTTP tests stay deterministic and simple. It captures each neutral request for assertions.
  - That leaves the Converse adapter's own mapping untested by those tests. Compensate with `converse-adapter.test.ts`: it drives the adapter with a stubbed `client.send` returning a recorded ConverseStream event sequence (text, a tool use, reasoning with a signature, a stop with cache usage), and asserts the exact `ConverseStreamCommand` input built.
  - Record those fixtures from a real staging call (V1).

## Steps

### PR 1 — Converse adapter + own loop (Opus 5 only, same grant)

- [x] 1. `lib/inference/types.ts` (new): the neutral request, message, content and event types, and the `InferenceProvider { name, modelId, streamRound }` interface. The request carries:
  - `system`: an array of strings
  - `tools`: `{name, description, inputSchema}`
  - `messages`
  - `maxTokens`, `effort` and `cache: boolean`
- [x] 2. `lib/inference/models.ts` (new): the D4 family table, with a unit test per family.
- [x] 3. `lib/inference/converse.ts` (new): the `ConverseAdapter`. It maps a neutral request to a `ConverseStreamCommand` (`system`, `toolConfig.tools` with `toolSpec.inputSchema.json`, `cachePoint`s per family, `inferenceConfig.maxTokens`, `additionalModelRequestFields`). It maps the stream events back:
  - `contentBlockStart` / `contentBlockDelta` / `contentBlockStop`
  - `messageStop.stopReason`
  - `metadata.usage`

  It also maps the AWS errors `ThrottlingException`, `AccessDeniedException`, `ValidationException` and `ModelNotReadyException` to a message that `turn.error` can carry. Lazy-import the client (D7).

- [x] 4. `lib/inference/anthropic.ts` (from today's `provider.ts`): the `AnthropicMessagesAdapter` on `beta.messages.stream`. It is a round, not `toolRunner`, so D2's A/B shares the loop.
- [x] 5. `lib/inference/provider.ts`: `resolveInferenceProvider()` picks the adapter by `ASSISTANT_INFERENCE_API` and keeps the model checks. `fake.ts` is rewritten per D9.
- [x] 6. `assistant/loop.ts`: the D3 loop over `streamRound`.
  - `prompt.ts` drops its Anthropic types. `systemBlocks` returns strings and the adapter places the cache point.
  - `historyFromTurns` returns neutral messages from the stored `{type:'text'}` blocks.
  - `AssistantEvent` and `TurnResult` are unchanged, so `http.ts`, `evals/runner.ts` and tenant-web don't change.
- [x] 7. Tests:
  - Rewrite `loop.test.ts` against the new fake. Keep every existing assertion's _intent_:
    - permitted tools only, sorted by name
    - cache requested after the system prompt
    - effort sent
    - the same system prefix on every round
    - every round is a complete request
    - usage summed across rounds
  - Add: tool error → `status:'error'` result; malformed tool JSON → error result; round limit; reasoning echoed on tool rounds; abort.
  - Add `converse-adapter.test.ts` (D9).
  - `http.test.ts` and `runner.test.ts` only swap fakes.
- [x] 8. Infra:
  - `apiBundling.nodeModules` gains `@aws-sdk/client-bedrock-runtime` (D7).
  - `api-stack.bundle.test.ts`: the assistant asset contains `ConverseStream`, and `node_modules/@aws-sdk/client-bedrock-runtime` exists in the asset.
  - Keep the `invoke-with-response-stream` assertion while the Anthropic adapter lives.
  - The grant is unchanged.
- [x] 9. Docs: GOTCHAS (drop `thread: false`; add D7's silent-drop trap); PATTERNS (the round seam); the parent plan's "as built" section gets a pointer here.
- [ ] 10. Verify in staging. **Gate G1 is V1–V4 green. Gate G2: the eval set on Converse is within noise of the recorded baseline** on pass rate, with cache reads present and no `max_tokens` stops.
  - The staging A/B needs `ASSISTANT_INFERENCE_API=anthropic` on AssistantFunction. That env var is **not wired in CDK**; it defaults to `converse`. For the A/B, add it to the function's `environment` in `api-stack.ts` for one staging deploy, or run the API locally with staging AWS credentials. Keep it out of `addApiEnvironment()`: the main API never needs it.
  - Replace the hand-written event sequence in `converse.test.ts` with one recorded at V1.

### PR 1 — as built (2026-11-21)

Departures from, and findings beyond, the text above:

- **D7's premise was half wrong.** `@aws-sdk/client-bedrock-runtime` _was_ installed: 3.1166.0, hoisted as a dependency of `@anthropic-ai/bedrock-sdk`. The primary checkout's `node_modules` was simply stale. The decision still stands, because the Lambda asset leaves `@aws-sdk/*` external and took the runtime's copy. It is now a direct `apps/api` dependency (`^3.1166.0`, a one-line lockfile change) in `apiBundling.nodeModules`. **The main API asset gets it too**: that bundling config is shared, and the Anthropic adapter, loaded by either Lambda, also requires it. The bundle test asserts both assets ship a copy ≥ 3.1166.
- **New trap: Converse requires strict role alternation.** The Anthropic API merged same-role runs; Converse rejects them. A failed exchange stores a question with no answer. `historyFromTurns` now:
  - merges same-role runs
  - drops leading assistant turns
  - drops a trailing unanswered question

  It is tested, and recorded in GOTCHAS.

- **Blank text blocks are dropped** by both adapters (Converse rejects them).
- **Bug caught in review:** a failed turn is stored as `[{type:'text', text:''}]`, because `recordExchange` writes `turn.text`.
  - Once the adapters dropped the blank text, that became an assistant message with _empty content_, which Converse rejects.
  - So every follow-up in a conversation with one failed turn would have failed. Staging will produce exactly that before the use-case form is in.
  - `historyFromTurns` now drops blank text. `http.test.ts` covers fail-then-continue on the real persistence path.
- **The trace order of tool calls is now the model's order**, not completion order: `Promise.all`, then one push per call in order.
- **A tool the model names but wasn't offered** gets an error result with `allowed: false`. The SDK runner had no such case, because it only dispatched offered tools.
- **Max rounds:** when the limit is reached on a `tool_use` stop, the last round's tools are **not** run (no model call would read them). `stopReason` stays `tool_use`.
- **AWS errors keep their name** (`AccessDeniedException: …`) in `turn.error`, so "the use-case form isn't submitted" or "no grant for this model" is recognisable in the Lab trace.
- **Verified locally:**
  - API 5404 tests, infra 454 (including the real-bundle test)
  - `tsc` clean; eslint clean on the changed sources
- **Not verified:** any real Bedrock call. Steps V1–V4 wait on prerequisites 1–2.

### PR 2 — model list + per-model evals

- [ ] 11. D8 in infra:
  - `assistantModels` prop and a grant over the list
  - `ASSISTANT_ALLOWED_MODELS` env
  - tests pinning: no `bedrock:*`, no `global.*`, and exactly the listed ARNs
- [ ] 12. Lab model picker on the eval pane, `--model` on `assistant:eval`, and the model id on every eval row. The Lab shows pass rate, tokens, rounds and latency side by side per model.
- [ ] 13. Add candidate models to staging's list: Claude Opus 5.5, Sonnet 5.5, Haiku 5.5, and at least one non-Anthropic model (Nova 2 Lite) to prove the neutral path. Do V5 for each.
- [ ] 14. Run the eval set per model. Record the results here and decide the default with Steve. Switching is the one-line D8 change.

### PR 3 — cleanup (after G2)

- [ ] 15. Delete `AnthropicMessagesAdapter`, the `ASSISTANT_INFERENCE_API` switch, `@anthropic-ai/sdk` and `@anthropic-ai/bedrock-sdk`, and the bundle-test `invoke-with-response-stream` assertion.

## Verification (staging, from the Assistant Lab)

- **V1** — Converse round trip with tools: a question needing two tool calls answers correctly, and the trace shows both. Capture the raw event sequence as the D9 fixture.
- **V2** — Opus 5 accepts `output_config.effort` via `additionalModelRequestFields` (no `ValidationException`). Turn latency or tokens differ between `low` and `high`.
- **V3** — A second turn with thinking on is accepted with text-only prior history (D5).
- **V4** — The second turn shows `cacheReadInputTokens > 0`, so the cache point after the system prompt covers tools and system.
- **V5 (per added model)** — An **admin** makes the first call. A third-party model's first call starts a Marketplace subscription, which the Lambda role can't do. Then the Lambda calls it successfully with the grant from step 11.

## Files

- **New:**
  - `apps/api/src/lib/inference/{types,models,converse,anthropic}.ts`
  - `converse-adapter.test.ts`
  - `models.test.ts`
- **Modified:**
  - `apps/api/src/lib/inference/{provider,fake}.ts`
  - `apps/api/src/assistant/{loop,prompt}.ts`
  - `loop.test.ts`, `http.test.ts`, `evals/runner.test.ts`
  - `apps/api/package.json`, `package-lock.json`
  - `packages/infra/lib/stacks/api-stack.ts` and its two tests
  - `packages/infra/bin/app.ts` (PR 2)
  - `apps/tenant-web/src/features/assistant/components/EvalPane.tsx` and `apps/api/scripts/assistant-eval.ts` (PR 2)
  - `dolas/agents/project/{GOTCHAS,PATTERNS}.md`
  - `plans/todo/ai-chat-assistant.md` (pointer)
- **Not touched:**
  - the Prisma schema / migrations
  - `assistant/http.ts`
  - `assistant/tools/*`
  - the Cedar policies
  - the Function URL / CORS

## Risks

- **Silent capability loss.** A Converse field the runtime or the model ignores does not error (D7). The defence is: V2/V4 in staging, the bundle test, and the adapter test asserting the exact command input.
- **Thinking signatures.** If the reasoning echo is wrong, the round after a tool call fails with a validation error. It's covered by a loop test (D5) and V1.
- **Parallel tool calls.** Some non-Anthropic models emit several `toolUse` blocks in one turn, or none when expected. The loop handles N per round; whether a given model uses tools well is exactly what step 14's evals measure.
- **Cost of the A/B (D2).** About half a day to port today's path onto the round seam. Drop D2 if the baseline isn't worth comparing.
- **Effort.** PR 1 is about 1.5–2 days; PR 2 about 1 day; PR 3 about an hour. None of it touches authz, tools or persistence.

## Out of scope

- Leaving Bedrock, including Claude Platform on AWS and the `bedrock-mantle` endpoint (not in the Service Authorization Reference).
- Guardrails.
- Per-tenant model choice.
- Phase 2 chat UI and Phase 3 GA (parent plan).
- A price table in code. The Lab reports tokens; dollars come from the Bedrock pricing page at decision time.
