# Workflow platform feedback round — five fixes

Source: external authoring feedback (2026-10-28), evaluated against code. Steve
approved all five; #4 as a per-trigger dry-run flag ("validate the trigger").

## 1. Tenant runner: give activities a real activity context

`apps/tenant-runner/pegasus_tenant_runner/subprocess_driver.py`
`_direct_execute_activity` calls `activity(*call_args)` bare, so
`activity.info()` raises `RuntimeError`. The SDK offline harness
(`pegasus_workflows.testing.run_activity`) runs the same call inside
`temporalio.testing.ActivityEnvironment` → tests pass, first dry run fails.

- Run the call through `ActivityEnvironment().run(activity, *call_args)` (same
  as the harness; the existing `isawaitable` branch handles async).
- Test: a driver test whose activity reads `activity.info().activity_type`.
- Docs: authoring CLAUDE.md + SDK README note that `activity.info()` in the
  runner carries synthetic values (ActivityEnvironment defaults).

## 2. `deployments.toml` keyed by profile

`push.py:56` `env_key = env or derive_env(base_url)`; QA + Prod share the API
host, so a Prod push overwrites QA's record.

- `env_key = env or profile or derive_env(base_url)` — an explicitly named
  `--profile` is the discriminator the author chose.
- Compat: existing host-keyed tables are untouched; a profile push adds a
  sibling table. Documented (CHANGELOG + README) with a rename hint.
- `--env` / `--profile` keying documented in README, authoring CLAUDE.md, MCP
  deployments resource docstring, `push --help`.

## 3. Requirements summary counts stale versions

`GET /workflows/requirements-summary` resolves every non-retired version row;
the Configs page (`variable-usage.ts`) inverts all of them. NW sees weichert
v0.4.0 (GLOBAL, still live) declaring `SEND_*`/`INTEGRATION_ID` in `global`,
long since removed in v0.5.0+.

- Server: tag each row `current: boolean` — the latest version (semver, upload
  time tie-break) per (owning tenant, name), OR any row that holds an ENABLED
  trigger of the caller's tenant (a pinned trigger still needs its keys).
  `totalMissing` counts current rows only. Rows stay in the response so the
  per-workflow detail page still finds every version.
- `compareSemver` moves to `packages/domain` (shared by API + tenant-web
  grouping, which already imports `@pegasus/domain`).
- Client: `buildVariableUsageIndex` skips non-current rows.
- SDK `requirements` CLI: show only current rows by default (`--all` for every
  version); OpenAPI + MCP doc the `current` field.
- Operational (NOT in this PR, Steve's call): retire weichert 0.4.x on prod;
  check whether 0.7.0 was ever pushed (ledger says 0.6.3).

## 4. Per-trigger dry-run flag

`startWorkflowExecution` already supports `dryRun` (TENANT_RUNNER only); the
dispatcher never passes it.

- Prisma: `WorkflowTrigger.dryRun Boolean @default(false)` + migration.
- API: `dryRun` on POST/PATCH trigger bodies + response; 400
  `DRY_RUN_UNSUPPORTED` when the workflow does not run on the tenant runner.
- Dispatcher: pass `dryRun: trigger.dryRun`; handle `DRY_RUN_UNSUPPORTED`
  outcome as a logged skip; log `dryRun` on fire.
- SDK: `dry_run` on `create_trigger` / `update_trigger`; CLI `schedule create
--dry-run`, `schedule dry-run <wf> <trigger> [--off]`; `schedule list` shows
  it.
- tenant-web: "Dry run" checkbox in the create-trigger dialog, a badge + a
  toggle on trigger rows.
- Docs: OpenAPI, README, CLAUDE.md (authoring), MCP reference.

## 5. Email recipient pre-check

- `services/email/outbound.ts`: extract `checkEmailRecipients(db, tenantId,
recipients)` (count cap + allowed-domain check); `sendTenantEmail` reuses it.
- New standalone `POST /api/v1/email/check-recipients` (`SendEmail`, not
  metered) `{to, cc?}` → `200 {data: {ok, reason, disallowed}}`, reason ∈
  `NOT_CONFIGURED | RECIPIENT_NOT_ALLOWED | TOO_MANY_RECIPIENTS | null`.
  Side-effect free, so it runs live under a dry run.
- SDK `check_email_recipients(to, cc=None)` (not captured in dry-run);
  `FakeClient` support; README/CLAUDE.md/MCP/OpenAPI.

## Release

SDK minor bump (new methods/fields) → CHANGELOG; publish tag after merge.

## Verification

- `apps/tenant-runner` pytest; `packages/workflows-sdk-python` pytest.
- `apps/api` vitest for the touched handlers/repo/dispatcher + typecheck.
- tenant-web vitest for variable-usage + workflow-grouping; typecheck.

## Outcome

All five implemented as planned. Two refinements made during implementation:

- #4: `dryRun` is refused only for curated (STDLIB) workflows. A
  not-yet-executable workflow skips every fire anyway, so it is allowed.
- #3: the CLI flag is `--all-versions` (not `--all`).

Owed after merge (not in this PR): publish SDK 0.54.0 (tag
`sdk-python-v0.54.0`); bump the authoring repo's pinned SDK + commit its
CLAUDE.md edits; Steve's call on retiring weichert 0.4.x on prod and on
whether 0.7.0 was ever pushed.
