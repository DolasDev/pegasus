# SDK feedback — close the open set (0032, 0033, 0043, 0044, 0045, 0046)

**Branch:** Phases 1–5 merged (#812, #813, #814, #817, #818). Phase 6 → `feat/order-status-write` (pegasus, worktree `~/repos/pegasus-order-status-write`), after a movemanager plan on `dev`. One worktree, branch and PR per phase, via `scripts/new-worktree.sh <type> <slug>`. The movemanager phases follow movemanager's own flow (a plan in `movemanager/plans/in-progress/`, approved first, then pushed to `dev`).
**Goal:** Resolve every sdk-feedback spec in `~/repos/pegasus-workflows/sdk-feedback/` that is still `Proposed` and has no active work behind it, so the authoring repo can mark each one `Validated`.
**Status:** APPROVED 2026-10-06 — all recommendations (D1–D8) accepted as written. Phases 1–5 MERGED and deployed to prod. **Phase 6 DONE 2026-10-09**: movemanager on `dev` (`79b3a355`), pegasus in this PR (SDK 0.49.0). **Authoring repo pin:** 0.38.0.
**Inputs:** the spec files named in each phase. Each phase lists the spec's acceptance criteria as its definition of done.

---

## Resume here (checkpoint 2026-10-08)

- **Where:** pegasus worktree `/home/steve/repos/pegasus-order-status-write`, branch `feat/order-status-write`. It was created off `origin/main` at `8995f296` (#818) for Phase 6 and has no commits yet.
  - The only change is this plan file. It is uncommitted on purpose: it is the checkpoint, and it lands with Phase 6's pegasus PR.
  - The primary checkout `~/repos/pegasus` stays on `main`. A hook blocks edits there.
- **Status:**
  - [x] Phase 1: #812, `97d24ae3`, SDK 0.46.0.
  - [x] Phase 2: #813, `c26b2b03`.
  - [x] Phase 3: #814, `b64f7400`, SDK 0.47.0. D6 prod check clean.
  - [x] Phase 4: #817, `be16d7d2`, SDK 0.48.0. Prod migration deployed.
  - [x] Phase 5: #818, `8995f296`, SDK 0.48.1.
  - Every tag (`sdk-python-v0.46.0` … `v0.48.1`) is published, every Deploy is green, and the authoring repo's `~/repos/pegasus-workflows/CLAUDE.md` is updated through 0.48.1 (its `main` is at `7d3822c`).
  - [x] Phase 6 (0044 A/B, order write-back): DONE 2026-10-09. movemanager `2d5714c9` (+ archive `79b3a355`) on `dev`; pegasus route + `WriteOrder` + SDK 0.49.0 in this PR. History: movemanager plan written 2026-10-08 — movemanager `plans/completed/2d5714c9-order-status-write.md` (branch `feat/order-status-write` off `origin/dev` @ `8ab2e341`, tracks `origin/dev` — push `HEAD:<branch>` explicitly). Its D9 corrects this plan: the field is `Survey.APIShipmentStatus` (`sales.special2`); `Survey.ShipmentStatus` does not exist. D8–D14 approved 2026-10-08. Trigger gate ran 2026-10-09 (NW+QMM; RVS tunnel down): mechanically safe, BUT NW runs a live in-DB Weichert pipeline owning both columns — D15 (a) and D16 approved 2026-10-09.
- **Next action (after this PR merges):** tag `sdk-python-v0.49.0` and publish; update the authoring repo's `CLAUDE.md` (`update_order`, the `APIShipmentStatus` correction, the NW in-DB Weichert warning); confirm the alpha pegII API manifest carries `79b3a355`.
- **In flight:** nothing. No open PR from this plan. Open PRs on the repo are #819 (another session, `chore/drop-pw-mcp-dep`) and draft #145. Re-check with `gh pr list --state open`.
- **Decisions & dead ends (this session):**
  - 0045 D: the spec claimed `prior` is unimplemented. It IS implemented: the validate endpoint loads the projection as `prior` via the input mapping, but no floor's facts read it. The docs now say that.
  - 0033 A: the spec's "display dropped on publish/pull" was not real. Nothing strips keys.
  - 0044 C: the 404 catch-all lives in `pegiiRuntimeHandler`, not in `tenant.ts` and not on `m2mV1`. Other m2m sub-routers still 401 on an unmatched route (noted in GOTCHAS).
  - 0032: the guards use the ROOT Prisma client, because other tenants trigger and run GLOBAL workflows. `workflows.ts` was added to the db-access-guard allowlist with that justification.
- **Gotchas:**
  - Worktree-isolated sessions refuse heredocs, `$(...)` and loops. Write commit messages to a scratchpad file and use `git commit -F`; run loops as `bash script.sh`.
  - After any local api test run or `git push`, `git restore apps/api/vitest.config.ts`. The coverage ratchet rewrites the floors, and committing them gets the PR ejected from the queue.
  - A new worktree comes up with `apps/e2e/.env.test` and `package-lock.json` modified. `git restore` both.
  - Merge-queue E2E can hang in `playwright install-deps` (`apt-get update` on the Ubuntu mirror). It ejected #818 twice. Diagnose with `gh run view <merge_group run> --json jobs`, then re-enqueue with `gh pr merge <N> --auto`. Do NOT watch with `gh pr checks`; watch the merge queue (memory `project_merge_queue_runbook`).
  - Before a tag push from `~/repos/pegasus`, if pre-push fails with `unknown key agentGuidance`, run `npm install` and revert `package-lock.json`.
  - Prod read-only SQL: `DATABASE_URL` from the prod API Lambda env via a scratchpad script. `aws sso login --profile dolas-pegasus-prod --use-device-code`.
- **Verification still owed (not this repo's CI):**
  - The authoring repo must bump its pin from 0.38.0 to 0.49.0 and re-run the ACs for 0032, 0033, 0043, 0044, 0045 and 0046 (interim) to mark them `Validated`.
  - **0044 A/B, live round-trip AC:** it needs an order on a site running `pegii.orders.write.v1`, and it must not be an NW Weichert order (D15 (a)). Spec 0044's AC paths must be amended from `Survey.ShipmentStatus` to `Survey.APIShipmentStatus`. The `weichert-milestone-update` AC (un-stub `write_statuses_to_pegii`) is BLOCKED by D15 (a) until a Weichert cutover plan retires NW's in-DB pipeline. Separately, the authoring repo's `weichert/mapping.json` reads `Survey.ShipmentStatus`, which doesn't exist, so it has always sent `null`.
  - 0032's e2e AC (the platform retires `send_order_to_partner` plus the leftover test versions) is the author's call and not done.

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

- **[x] D6 prod check done 2026-10-07 (clean):** 1 feedback form across all tenants, 0 stray question keys, 0 stray top-level keys. Posted on #814 before enabling auto-merge. #814 merged as `b64f7400`, and SDK 0.47.0 is published.
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

## Phase 4 — Retire a published workflow (0032) → SDK 0.48.0

**Code done 2026-10-07 on `feat/retire-workflow`.** The `Workflow.kind` migration from the long-running plan was neither on `main` nor in flight, so this went first; that plan rebases onto `status`. API 4016/4016, SDK 452 (+8).

- **Migration** `20261007182425_add_workflow_status`. Expand-only: a new enum, `status` NOT NULL DEFAULT `ACTIVE`, and nullable `retired_at` / `retired_by_user_id`.
- **One choke point.** `findByIdForTenant` / `listForTenant` hide RETIRED rows unless `{ includeRetired: true }`. Get, download-url, fork, run, retry, trigger create/patch, requirements-summary and the trigger DISPATCHER (which skips them as `WORKFLOW_NOT_FOUND`) all refuse a retired row by default. Execution list/get/history/cancel and trigger list/delete opt in, so history and cleanup still work. The runner's artifact list (`/internal/tenant-workflows`) filters `status: 'ACTIVE'`.
- **Routes:** `POST /workflows/retire {name, version?}` and `POST /workflows/:id/retire`, gated by `UploadWorkflow`.
  - 200 returns `{retired, alreadyRetired, forkCount}`.
  - 409 `WORKFLOW_IN_USE` names the blockers.
  - 403 for a visible GLOBAL workflow the caller doesn't own; 404 otherwise. A body key outside the schema is a 400.
- **Guards use the ROOT client** (`WorkflowRepository.retire`, one transaction). A GLOBAL workflow is triggered and run by tenants that never forked it. `workflows.ts` joins the db-access-guard allowlist with that justification, and ownership is the explicit `tenantId` predicate.
  - Proven against a real DB in `repositories/__tests__/workflow-retire.repository.test.ts`, with another tenant's trigger and execution, all-or-nothing, the fork count, and idempotency.
- **SDK:** `retire_workflow`, `list_workflows(include_retired=)`, and a new `WorkflowInUse(PegasusApiError)` carrying `enabled_triggers` / `open_executions`. The CLI is a TOP-LEVEL `pegasus-workflows retire <name>[@version] [--yes]`, because there is no `workflow` group.
- **tenant-web:** no change. The list hides retired rows because the API default does. A "show retired" toggle is not built.
- **MCP:** `pegasus://reference/api` picks up `retire_workflow` from its docstring. No other MCP surface lists commands.

**Ordering:** `apps/api/prisma/schema.prisma` is a hot file. The long-running plan adds `Workflow.kind` plus a migration. Whichever starts second rebases onto the first; don't run both at once. Retirement must work the same for both kinds, Automation and Workflow.

- [x] Prisma: `Workflow.status` (`ACTIVE | RETIRED`, default `ACTIVE`), plus `retiredAt` and `retiredByUserId`, with a migration.
- [x] API `handlers/workflows.ts`: `POST /workflows/:id/retire`, and a by-name form for "every version". Guards per D2, auth per D3.
  - `GET /workflows` hides RETIRED rows unless `?includeRetired=true`.
  - `get`, `run`, `fork` and download-url return 404 for a retired row. The dispatcher's trigger resolution also skips retired rows.
  - `push` of a retired `(name, version)` still returns 409, because versions are immutable.
- [x] SDK: `retire_workflow(name, version=None)`, `list_workflows(include_retired=False)`, and a CLI verb (`pegasus-workflows workflow retire <name>[@version]`, fitted to the existing command layout).
- [x] tenant-web: the workflows list hides retired rows, or greys them behind a toggle.
- [x] Tests (integration):
  - The platform tenant retires a GLOBAL workflow, then `get` and `run` return 404 and the list drops it.
  - A non-platform caller gets 403 on GLOBAL.
  - An enabled trigger blocks the retire with 409.
  - An open execution blocks the retire with 409.
  - A fork stays runnable after its source is retired.
- [x] Discovery: README, MCP, `--help`, OpenAPI, the authoring repo's `CLAUDE.md`.
- [ ] After merge: the platform retires `send_order_to_partner` and the test-vehicle `weichert-milestone-update` versions the author lists. This is the spec's e2e AC, and it is the author's call.

## Phase 5 — Make the task stub honest until pulse Phase 6 lands (0046 B/C, interim) → patch bump

Applies only if D7 is approved. This changes `services/pegii-tasks.ts`, which pulse Phase 6 deletes.

**Done 2026-10-07 on `fix/honest-pegii-task-stub`.** Phase 4 merged as #817 (`be16d7d2`), and SDK 0.48.0 is published. API 4019/4019, SDK 452.

- `closeTask` returns null instead of fabricating a row, and the route answers `404 TASK_NOT_FOUND`. A new real-DB case in `__tests__/usage-meter.integration.test.ts` proves the miss is not metered.
- `toTaskResponse` sets `stub: true`.
- OpenAPI gains `closePegiiTask` plus list/get response descriptions. SDK docstrings, README and CHANGELOG (0.48.1) are updated; no SDK code changed.
- The "Pulse plan Phase 6" ACs below were folded into `nw-pulse-texting-platform.md` Phase 6 in this same PR, with a version-drift note.

- [x] A close matching a task that was never listed or created → `404`. No row is created, and no usage is metered.
- [x] Every stub row carries `stub: true`, and the SDK docstrings for `list_tasks`, `get_task` and `close_task` say so.
- [x] Add the close route to OpenAPI and give `listPegiiTasks` a response schema.

## Pulse plan Phase 6: add these ACs (0046)

**Folded in 2026-10-07**, alongside Phase 5. The checkboxes below mean "added to the pulse plan", not "built". The work is tracked there.

`plans/in-progress/nw-pulse-texting-platform.md` Phase 6 already covers `create_task`, close by id, `list_tasks` filters and the desktop guard fix. Spec 0046 adds the items below. Fold them into that plan's Phase 6 checklist; don't duplicate the work here.

- [x] Task ids are opaque per-instance ids (the `Tasks.id` PK), never `task_{orderId}_{taskType}`.
- [x] `close_task`: pass exactly one of `task_id` or `(order_id, task_type)`, or get a `ValueError` before any request. An `(order_id, task_type)` matching two or more open tasks → `409` naming the candidate ids. A match on nothing → `404`. A genuine repeat close still returns `alreadyClosed: true`.
- [x] Metering: a refused close (404 or 409) and an `alreadyClosed` replay don't meter. Only a real close does.
- [x] `list_tasks` for a nonexistent order → `404` (or `502 PEGII_SOURCE_*`). An order with no tasks returns `[]`. Nothing is minted at read time.
- [x] `create_task` without `CreateTask` → 403. Also run 0009's still-unvalidated AC3 for `CloseTask`.
- [x] `create_task` is in `testing._MUTATIONS` and captured under `--dry-run`.
- [x] OpenAPI documents the create route; the MCP `pegasus://reference/api` resource lists `create_task` and the new `close_task` signature.
- [x] **Version drift:** that plan still names SDK 0.44.0 and 0.45.0 for Phases 6 and 7. #792 and #793 have already used both. Renumber to "next free minor at merge".

## Phase 6 — Order write-back (0044 A/B): movemanager first, then pegasus

There is no home for this today: pulse Phase 7 is memos, not an order patch. It follows the pulse rule of real pegII API endpoints, with no stubs and no direct cloud→MSSQL access. It ships through the same rollout as pulse Phase 5.

**Done 2026-10-09.** movemanager `2d5714c9` is on `dev` (plan archived at `79b3a355` as `plans/completed/2d5714c9-order-status-write.md`), and the pegasus side ships in this PR. What happened differently from the plan:

- **The second field is `Survey.APIShipmentStatus` (`sales.special2`).** `Survey.ShipmentStatus`, as named by the spec and the first draft of this plan, does not exist in the native order. A write to it is a 400 that suggests the real name.
- **Snapshot risk: patched on write.** `sales` and `SaleSerializedSnapshot` change in one transaction. The JSON is edited in C#, because pegNW/pegQMM run at compat 100/120, below `JSON_MODIFY`'s 130. The response comes from the serialized GET's own handler.
- **The trigger gate found a live in-DB Weichert pipeline on NW** (GOTCHAS "NW's own database already runs a Weichert integration…"). D15 (a): the endpoint ships, but NW's Weichert workflow must not use it until a cutover. D16: writes stamp `labor_names = '1001'` where that employee exists.
- **Outcome flag and billing:** the site reports applied/unchanged in an `X-Pegasus-Applied` header. The pegasus route re-emits it as `meta.applied` plus the same header, and `BILLABLE_ACTIONS.WriteOrder` bills only `applied` writes, minting one key per write.
- **`role-options` needed nothing:** it lists roles, not actions. The tenant Usage page got a `WriteOrder` label instead.

- [x] **movemanager plan** (`plans/in-progress/order-status-write.md`, approved before code): `PATCH /api/v1/pegii/orders/{orderNumber}` per D8.
  - An allowlist that starts as `Survey.SerivceStatus` and `Survey.APIShipmentStatus` (corrected from `Survey.ShipmentStatus`), mapped to their `sales` columns.
  - `400` naming any path outside the allowlist. `404` for an unknown order. Idempotent. Returns the updated order in native shape.
  - Before shipping, re-read the triggers on `sales` (`sys.triggers`), using the #668 GOTCHAS recipe. Done for NW and QMM; RVS was unreachable and is still owed.
- [x] **Risk to settle in that plan:** the pulse plan found the serialized order snapshot goes stale against DB triggers. The spec's round-trip AC (`get_order(shape="native")` shows the written value) holds only if the response and later reads come from live columns, not the snapshot. Either regenerate the snapshot on write, or read the patched fields live. Settled by patching the snapshot in the same transaction.
- [x] **pegasus:** add the `PATCH /api/v1/pegii/orders/:orderId` route through the pegII gateway (`OrderGateway.updateOrderNative`, gated on `pegii.orders.write.v1`). Upstream 400 and 404 pass through with pegII's code.
  - Add a new Cedar action, `WriteOrder`, to the schema and the `workflow_runtime` persona grant.
  - Meter it: `billable-actions.ts`, `meterUsage(Actions.WriteOrder)`, and the README's billable list.
- [x] SDK 0.49.0: `update_order(order_id, patch)`, listed in `testing._MUTATIONS` as `"update_order": "WriteOrder"`, and captured under `--dry-run`. README, CHANGELOG, MCP guidance and OpenAPI are updated. The authoring repo's `CLAUDE.md` follows the tag.
- [ ] Authoring side (not this repo): `weichert-milestone-update`'s `write_statuses_to_pegii` stops being a stub. **Blocked by D15 (a) on NW** until a Weichert cutover plan exists.

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
