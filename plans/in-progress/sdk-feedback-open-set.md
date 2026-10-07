# SDK feedback — close the open set (0032, 0033, 0043, 0044, 0045, 0046)

**Branch:** Phase 1 → `feat/sdk-feedback-open-set` (this plan file rides with Phase 1's PR; later phases update it in their own PRs). One worktree, branch and PR per phase, via `scripts/new-worktree.sh <type> <slug>`. The movemanager phases follow movemanager's own flow (a plan in `movemanager/plans/in-progress/`, approved first, then pushed to `dev`).
**Goal:** Resolve every sdk-feedback spec in `~/repos/pegasus-workflows/sdk-feedback/` that is still `Proposed` and has no active work behind it, so the authoring repo can mark each one `Validated`.
**Status:** APPROVED 2026-10-06 — all recommendations (D1–D8) accepted as written. **SDK today:** 0.45.1. **Authoring repo pin:** 0.38.0.
**Inputs:** the spec files named in each phase. Each phase lists the spec's acceptance criteria as its definition of done.

---

## Scope

| Spec         | What is still open                                                                                                  | Where it goes                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **0043**     | The six `shipments[].surveyed*` cost components are required keys on the canonical contract                         | **Phase 1** (pegasus)                                                                                                      |
| **0045**     | `shipment_status_update` has no correlation binding; the dry-run result drops `correlation`; three docstring errors | **Phase 1** (pegasus)                                                                                                      |
| **0044 C**   | A valid `vnd_` key on a route that doesn't exist gets `401 "Invalid or unverifiable token"`                         | **Phase 2** (pegasus)                                                                                                      |
| **0033**     | Feedback-form `rating` has no `display` option, and the validator ignores unknown question keys                     | **Phase 3** (pegasus: API + tenant-web + SDK)                                                                              |
| **0032**     | A published workflow can't be retired or deleted                                                                    | **Phase 4** (pegasus)                                                                                                      |
| **0046**     | The task surface is an in-memory stub: no create, no close by id, a close that matches nothing returns `200`        | **Pulse plan Phase 6** already owns it. This plan adds an interim fix (**Phase 5**) and the ACs Phase 6 is missing (below) |
| **0044 A/B** | No order-write endpoint and no `update_order`                                                                       | **Phase 6**: a new movemanager plan, then pegasus                                                                          |

**Out of scope:**

- **0008** (long-running workflows) is being built under `plans/in-progress/long-running-workflows-and-automations.md`.
- **0009**: what's left are its live and e2e criteria. They are gated on 0008, and on 0046 through Phase 6. Nothing here is specific to 0009.
- Specs already `Validated` that list small unexercised leftovers: 0015 Part D (web-UI trace), the reachable-source 404 in 0018, bound execution and dedup in 0021, the over-cap 413 and cross-tenant check in 0025, the role-403 in 0026, and the optional Part C of 0042. The authoring side closed these as accepted. Reopen them only if the author files a new spec.

---

## Decisions (all approved 2026-10-06 as recommended)

- **D1 (0032): retire, not delete.** Recommendation: add a soft `RETIRED` status on the `Workflow` row, kept for audit. A retired workflow is not runnable, not forkable, and not listed by default. Hard delete is never exposed. Restoring one stays a platform-side DB fix in v1, unless you want `restore` now.
- **D2 (0032): dependency guards.** Recommendation:
  - Refuse with `409` while an **enabled trigger** is bound to the workflow, and name the trigger ids.
  - Refuse with `409` while **non-terminal executions** exist. This is the long-running interaction: a durable Workflow can be open for days.
  - For a GLOBAL row, this check must look **across tenants**. The Prisma tenant extension scopes `WorkflowExecution` reads to the caller, so a platform-tenant query sees only its own runs. Use the unscoped client, and add a test where another tenant's run is open.
  - **Tenant forks** are independent `Workflow` rows (`forkedFromWorkflowId`), so retiring the GLOBAL source doesn't break them. List them in the response and leave them alone. No cascade flag in v1.
- **D3 (0032): authorization.** Recommendation: reuse `UploadWorkflow` ("the same role that can publish", as the spec asks). A tenant can retire only its own rows. GLOBAL rows can be retired only by the platform tenant. No new Cedar action, which also keeps the hot file `authz/actions.ts` untouched.
- **D4 (0045 E): projection `entityType` and `state`.** Recommendation: **document both as free-form**, don't enforce. Enforcing `entityType` would break callers today, and it would close the two-row workaround that authors may already rely on. Document `state` as an opaque JSON blob with the 256 KB cap.
- **D5 (0033): field names.** Recommendation: use `display` and `scaleLabels` on the wire. Definitions already use camelCase (`maxLength`). The spec's `scale_labels` was written in the SDK's Python style.
- **D6 (0033 B): unknown keys are an error, not a warning.** Recommendation: reject them at validate and publish time. A form that's already published is never re-validated, so nothing that's live breaks. Before shipping, query prod `FeedbackForm` definitions for keys outside the allowlist, so a tenant's next republish doesn't fail by surprise.
- **D7 (0046 interim): make the stub honest now (Phase 5) instead of waiting for pulse Phase 6.** Recommendation: yes, **unless NW's rollout is about to resume**.
  - Pulse Phase 5's original blocker (cloud identity I1 + I2) is cleared.
  - Phases 6–7 now wait on NW's rollout, which is on hold (`plans/todo/cloud-identity-and-companies.md`, item 4). Until then, closing a task that doesn't exist counts as a billable success.
  - Safe to flip `200`→`404` now: the only authoring-repo caller of `close_task` is `nw/order_lifecycle`. It isn't runnable (it's gated on 0008), and its docstring already expects a 404 for "no such order/task".
- **D8 (0044 A): request shape.** Option 1 is the spec's native-shape fragment (`{"Survey": {"SerivceStatus": …}}`) with a server-side allowlist of writable paths. Option 2 is a narrow typed endpoint (`PATCH …/status {serviceStatus, shipmentStatus}`). Recommendation: **option 1**. Reading and writing then use one vocabulary, and the allowlist is the extension point. It is decided finally in the movemanager plan, against what the `sales` columns allow.

---

## Phase 1 — `shipment_status_update` floor: optional components + a correlation binding (0043, 0045) → SDK 0.46.0

One PR, because both changes touch the same floor and share one SDK bump.

**Done 2026-10-06 on `feat/sdk-feedback-open-set`.** API tests 3979/3979, SDK 444 (+4 new), typecheck and lint clean. What happened differently from the plan:

- **0043 AC6:** the floor contract emitted no `required[]`. It now publishes `requiredCanonicalFields` (new `canonicalRequiredPaths` in `transform/mapping-static-check.ts`; a key counts only if its whole ancestor chain is required).
- **0043 open question:** the "omitting a field doesn't add a null to the external body" note went into the canonical schema comment, not `factDocs`. It describes a field, not a fact.
- **0045 D, the spec was wrong about `prior`:** it IS implemented. The validate endpoint, called without `prior`, loads the projection by the floor key and runs it through the INPUT mapping (`handlers/integration-validation/validate.ts` `resolveProjectionPrior` → `integration-validation/validate.ts`). An unparseable state is silently treated as no-prior, and **no built-in floor's facts read `prior`**. The docstring now says exactly that, instead of dropping the coupling.
- **0045 A:** `projection.localEntityType` is published on the floor detail (and in OpenAPI). Config-only partners inherit the binding through `composeDefinition` (`registry.test.ts`).
- **Still owed after merge:** tag `sdk-python-v0.46.0` and publish, then update the authoring repo's `CLAUDE.md` projection note. The authoring side validates 0043/0045 (live: `weichert` returns `outcome: created`).

**0043 (API)**

- [x] `apps/api/src/integration-validation/canonical-demo-partner.ts`: make the six `surveyed*` fields `moneyOrNull.optional()`. The fallback sum (`facts/demo-partner-facts.ts`, `nz`) already treats `undefined` as 0, so the facts don't change. Write the tests first:
  - Mapping none of the six gates `ok`.
  - None mapped plus `estimatedTotalCost` mapped makes the fact equal CoreCost.
  - None mapped and the total unmapped gives a sum of 0, and the submit rule fires.
  - Mapping two of the six sums only those two.
  - The current Weichert-shaped mapping produces a byte-identical canonical order.
- [x] Spec AC6: the floor's published contract (`GET /integrations/floors/:id`) must mark required vs optional fields. First check whether the JSON-Schema rendering already emits `required[]`. If it does, assert it in a test. If it doesn't, add it.
- [x] Spec open question: optional on the canonical layer is not the same as absent from the partner body. Leave `external_mapping` as it is, and say in the floor `factDocs` that omitting a field on the canonical side doesn't add nulls to the external body.

**0045 (API + SDK)**

- [x] A: add `correlation: { localEntityType: 'order' }` to `floors/shipment-status-update.floor.ts`. Checked: `localEntityId` is a free string (`integration-correlation.repository.ts` has no FK), so a pegII order number is valid. Tests: `created`, then `unchanged`, then `get_correlated_state` by `490317`, and a wrong `localEntityType` gives `rejected`.
  - Also fix the floor comment that says the validator loads the projection "as `prior`", if that path doesn't exist (D below).
- [x] B: `PegasusClient._capture_mutation`, and its mirror in `pegasus_workflows.testing`, return `correlation: {"outcome": "dryRun"}` when a binding was requested, and leave the key out when none was. Offline test for both cases, keeping 0016's rule that the server-side and offline capture shapes match.
- [x] C/D: correct the `put_projection` docstring:
  - `correlation` is an object `{outcome, error?}`, with the outcomes listed.
  - `state` is the partner's record in the partner's own shape. For an outbound integration that is the external body.
  - Remove the `order`/`prior` validator coupling. Check `prior` in the validator first: if it's real, document it accurately; if not, remove it.
- [x] E (per D4): document `entity_type` and `state` as free-form.
- [x] Discovery surfaces: SDK README, the MCP `pegasus://reference/api` resource, CHANGELOG, a version bump, and the authoring repo's `CLAUDE.md` projection note.

## Phase 2 — An unmatched route answers 404, not 401 (0044 C), API only

**Done 2026-10-06 on `fix/pegii-unmatched-route-404`.** Phase 1 merged as #812 (`97d24ae3`), and SDK 0.46.0 was tagged and released. Red then green: 4 invented routes returned 401 before the fix and 404 after. API tests 3985/3985.

- The fix is a terminal `pegiiRuntimeHandler.all('*')` 404 after dual auth.
- New test `__tests__/pegii-unmatched-route.test.ts` drives the real `app` with only dual-auth mocked. It checks that invented routes return 404, a bad key returns 401, and a real route is unchanged.
- GOTCHAS gained a paragraph under the existing `/api/v1` split section, and the SDK README got a note in the `api_get` section. No SDK bump.
- Other m2m sub-routers still answer 401 on an unmatched route. That is out of scope for 0044 C, and documented in GOTCHAS.

- [x] Find the cause first. `m2mV1` and `v1` are both mounted at `/api/v1` (`app.ts`). An authenticated `vnd_` request that matches no `m2mV1` route falls through to `v1`'s tenant middleware, which rejects a non-Cognito token at `middleware/tenant.ts:73` before `app.notFound` can answer. Confirm with a failing test: a valid `vnd_` key on `POST /api/v1/pegii/orders/zzz/close` → today 401.
- [x] Fix: add a terminal `.all('*')` that returns `404 NOT_FOUND` inside `pegiiRuntimeHandler`, after dual auth. It's narrow, it matches the spec's AC literally, and it covers the `/pegii/tasks` routes that 0046's probes hit.
  - **Not** in `tenant.ts`. That would make the Cognito plane verify API keys on every `vnd_` request, in the same class of file that broke in #447/#526.
  - **Not** as a catch-all on `m2mV1`. It shares the `/api/v1` mount with `v1`, so it would swallow every Cognito route. If broader coverage is wanted later, the safe form is one terminal catch-all per m2m subrouter.
  - Run the whole `/internal` broker suite and the authz smoke checks.
- [x] Tests: a valid key on an invented route → 404; a bad key on an invented route → 401; a valid key on a real route → unchanged.
- [x] Note in the SDK README's error section. No SDK bump needed unless `PegasusApiError` text references the old status.

## Phase 3 — Feedback forms: strict question keys + `display` on `rating` (0033) → SDK 0.47.0

**Code done 2026-10-07 on `feat/feedback-form-strict-rating-display`.** API 3999/3999, tenant-web 1550/1550, SDK 444. Typecheck, eslint and `ruff check` are clean. Phase 2 merged as #813 (`c26b2b03`).

- **[ ] D6 prod check still owed before merge.** AWS SSO had expired. The query is a read-only scratchpad script (`feedback-form-stray-keys.sh`: `DATABASE_URL` from the prod API Lambda env, then `psql` with `default_transaction_read_only`). It lists stored question keys outside the allowlist, plus top-level keys other than `questions`. The PR is open WITHOUT auto-merge until it runs.
- **The "drop" was not real.** Neither the API (`PublishBody` is `z.record`, Prisma `Json`) nor the SDK/CLI (`_load_form` passes `definition` through) strips keys. The spec's pulled form had simply been published without `display`. A handler test pins the round trip.
- **Wider than the plan:** unknown TOP-LEVEL definition keys are rejected too. That covers the same silent-accept class, and the D6 query checks for them as well.
- The rating control was extracted to `apps/tenant-web/src/components/feedback/RatingInput.tsx`, with component tests. No browser e2e: the e2e suite has no `/f/:token` coverage to extend. An unknown `display` value falls back to numeric, so a newer definition never fails to render on an older build.
- MCP: no feedback-specific resource exists, and `pegasus://reference/api` is generated from docstrings, so the docstring change covers it.

- [x] B first (tests first) in `apps/api/src/lib/feedback-form.ts`: an allowlist of keys per question type. An unknown key gives an error naming the key and the question path. Run the D6 prod query before merging.
- [x] A: `rating` accepts `display: "faces" | "stars" | "numeric"` (default `numeric`) and an optional `scaleLabels` keyed by scale value.
  - `faces` with `max - min + 1 > 7` is rejected.
  - Confirm `display` round-trips through publish and pull. The API looks like it stores `definition` raw (`PublishBody` is `z.record(z.string(), z.unknown())`) and `feedback-public` returns it raw. So the drop the spec saw may be on the SDK side (the CLI's form loader or `publish_feedback_form`). Find that first, and don't scope the fix to the API until it's known.
  - `compileResponseSchema` is unchanged: the response is still an integer.
- [x] Rendering, `apps/tenant-web/src/routes/f.$token.tsx` (the hosted form renders `rating` as number buttons today):
  - `faces`: least to most satisfied faces, each with an `aria-label` that carries the number.
  - `stars`: a star bar.
  - `scaleLabels` captions the two ends. Omitting `display` renders exactly as today.
  - Component tests for all three modes, plus a browser e2e if the feedback e2e suite covers `/f/:token`.
- [x] SDK: the `validate_feedback_form` docstring documents `display`, `scaleLabels` and the unknown-key policy. Also update the README, MCP reference, CLI `feedback-form --help` and OpenAPI.

## Phase 4 — Retire a published workflow (0032) → next SDK minor

**Ordering:** `apps/api/prisma/schema.prisma` is a hot file. The long-running plan adds `Workflow.kind` plus a migration. Whichever starts second rebases onto the first; don't run both at once. Retirement must work the same for both kinds, Automation and Workflow.

- [ ] Prisma: `Workflow.status` (`ACTIVE | RETIRED`, default `ACTIVE`), plus `retiredAt` and `retiredByUserId`, with a migration.
- [ ] API `handlers/workflows.ts`: `POST /workflows/:id/retire`, and a by-name form for "every version". Guards per D2, auth per D3.
  - `GET /workflows` hides RETIRED rows unless `?includeRetired=true`.
  - `get`, `run`, `fork` and download-url return 404 for a retired row. The dispatcher's trigger resolution also skips retired rows.
  - `push` of a retired `(name, version)` still returns 409, because versions are immutable.
- [ ] SDK: `retire_workflow(name, version=None)`, `list_workflows(include_retired=False)`, and a CLI verb (`pegasus-workflows workflow retire <name>[@version]`, fitted to the existing command layout).
- [ ] tenant-web: the workflows list hides retired rows, or greys them behind a toggle.
- [ ] Tests (integration):
  - The platform tenant retires a GLOBAL workflow, then `get` and `run` return 404 and the list drops it.
  - A non-platform caller gets 403 on GLOBAL.
  - An enabled trigger blocks the retire with 409.
  - An open execution blocks the retire with 409.
  - A fork stays runnable after its source is retired.
- [ ] Discovery: README, MCP, `--help`, OpenAPI, the authoring repo's `CLAUDE.md`.
- [ ] After merge: the platform retires `send_order_to_partner` and the test-vehicle `weichert-milestone-update` versions the author lists. This is the spec's e2e AC, and it is the author's call.

## Phase 5 — Make the task stub honest until pulse Phase 6 lands (0046 B/C, interim) → patch bump

Applies only if D7 is approved. This changes `services/pegii-tasks.ts`, which pulse Phase 6 deletes.

- [ ] A close matching a task that was never listed or created → `404`. No row is created, and no usage is metered.
- [ ] Every stub row carries `stub: true`, and the SDK docstrings for `list_tasks`, `get_task` and `close_task` say so.
- [ ] Add the close route to OpenAPI and give `listPegiiTasks` a response schema.

## Pulse plan Phase 6: add these ACs (0046)

`plans/in-progress/nw-pulse-texting-platform.md` Phase 6 already covers `create_task`, close by id, `list_tasks` filters and the desktop guard fix. Spec 0046 adds the items below. Fold them into that plan's Phase 6 checklist; don't duplicate the work here.

- [ ] Task ids are opaque per-instance ids (the `Tasks.id` PK), never `task_{orderId}_{taskType}`.
- [ ] `close_task`: pass exactly one of `task_id` or `(order_id, task_type)`, or get a `ValueError` before any request. An `(order_id, task_type)` matching two or more open tasks → `409` naming the candidate ids. A match on nothing → `404`. A genuine repeat close still returns `alreadyClosed: true`.
- [ ] Metering: a refused close (404 or 409) and an `alreadyClosed` replay don't meter. Only a real close does.
- [ ] `list_tasks` for a nonexistent order → `404` (or `502 PEGII_SOURCE_*`). An order with no tasks returns `[]`. Nothing is minted at read time.
- [ ] `create_task` without `CreateTask` → 403. Also run 0009's still-unvalidated AC3 for `CloseTask`.
- [ ] `create_task` is in `testing._MUTATIONS` and captured under `--dry-run`.
- [ ] OpenAPI documents the create route; the MCP `pegasus://reference/api` resource lists `create_task` and the new `close_task` signature.
- [ ] **Version drift:** that plan still names SDK 0.44.0 and 0.45.0 for Phases 6 and 7. #792 and #793 have already used both. Renumber to "next free minor at merge".

## Phase 6 — Order write-back (0044 A/B): movemanager first, then pegasus

There is no home for this today: pulse Phase 7 is memos, not an order patch. It follows the pulse rule of real pegII API endpoints, with no stubs and no direct cloud→MSSQL access. It ships through the same rollout as pulse Phase 5.

- [ ] **movemanager plan** (`plans/in-progress/order-status-write.md`, approved before code): `PATCH /api/v1/pegii/orders/{orderNumber}` per D8.
  - An allowlist that starts as `Survey.SerivceStatus` and `Survey.ShipmentStatus`, mapped to their `sales` columns.
  - `400` naming any path outside the allowlist. `404` for an unknown order. Idempotent. Returns the updated order in native shape.
  - Before shipping, re-read the triggers on `sales` (`sys.triggers`), using the #668 GOTCHAS recipe.
- [ ] **Risk to settle in that plan:** the pulse plan found the serialized order snapshot goes stale against DB triggers. The spec's round-trip AC (`get_order(shape="native")` shows the written value) holds only if the response and later reads come from live columns, not the snapshot. Either regenerate the snapshot on write, or read the patched fields live.
- [ ] **pegasus:** add the `PATCH /api/v1/pegii/orders/:orderId` route through the pegII gateway. Map upstream 400/404 so they aren't disguised as a 502 (the pulse Phase 5 change to `pegiiApiErrorToHttp`).
  - Add a new Cedar action, `WriteOrder`, to the schema, the persona grants and `role-options`.
  - Meter it: `billable-actions.ts`, `meterUsage(Actions.WriteOrder)`, and the README's billable list.
- [ ] SDK: `update_order(order_id, patch)`, listed in `testing._MUTATIONS` as `"update_order": "WriteOrder"`, and captured under `--dry-run`. Also update the docs surfaces and the authoring repo's `CLAUDE.md`.
- [ ] Authoring side (not this repo): `weichert-milestone-update`'s `write_statuses_to_pegii` stops being a stub.

---

## Every PR that bumps the SDK

- [ ] The SDK method or field, the README, the MCP `pegasus://reference/*` resource, CLI `--help`, `/openapi.json`, and the CHANGELOG.
- [ ] Any new action that mutates outward-facing state is metered in the same PR.
- [ ] After merge: tag `sdk-python-vX.Y.Z` and publish (standing rule). Push the authoring repo's `CLAUDE.md` update.
- [ ] Validation is done in the authoring repo: upgrade it from 0.38.0 to the new SDK first, then run each spec's ACs and set its `Status`.

## Order and parallelism

- Phases 1, 2 and 3 are independent pegasus-only PRs and can run in parallel. Their only shared hot file is `openapi-spec.ts`, which merges as plain text.
- **This plan file rides with Phase 1's PR.** Every later phase edits it too, so start each later phase in a fresh worktree off `origin/main` _after_ the previous phase has merged, or rebase before touching the plan. Otherwise the plan file conflicts with itself.
- Phase 4 is serialized with the long-running plan's `Workflow.kind` migration.
- Phase 5 is only worth doing while NW's rollout is on hold (D7).
- Phase 6 and pulse Phase 6 are gated by the movemanager rollout. Each needs its movemanager plan approved and pushed before its pegasus PR.

## Risks

- **0033 B** can fail a tenant's _next_ republish of a form that carries a stray key. The D6 prod query sizes this before merge.
- **0044 C** touches the auth fallthrough that has broken twice (#447, #526). Keep the fix narrow, and keep the broker-route tests in the gate.
- **0032** retirement must never strand a running durable Workflow. That's why there's an open-execution guard (D2), and why it lands after, or together with, the long-running plan's versioning work.
- **0045 A** only changes behaviour for callers that pass `local_entity_*`. Today they get `unsupported`, so no working caller changes.
