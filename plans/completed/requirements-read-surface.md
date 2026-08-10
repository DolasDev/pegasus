# Fork carries declared keys + an SDK read surface for requirement status

Three related gaps in the declared-secrets/configs feature (#538/#540), found while auditing
whether the SDK covers it.

## Part A — integration fork silently drops fields (BUG, highest value)

`PublishConfigInput` carries `inbound`, `requiredSecrets`, and `requiredConfigs`
(`apps/api/src/repositories/integration-config.repository.ts`), and the publish path sets all
three (`handlers/integration-validation/config.ts:261`). The **fork** path's `repo.publish`
call (same file, ~555-573) spreads `mapping`, `rules`, `corpus`, `gateReport`, `floor`,
`displayName`, `externalShape`, `externalMapping` — and **none of those three**.

So forking a platform integration into a tenant overlay loses:

- `requiredSecrets` / `requiredConfigs` — the forked overlay declares nothing, so the tenant's
  present/missing view goes blank for exactly the integration they just adopted. This is what
  the whole #540 feature exists to prevent.
- `inbound` — worse, and not merely informational: a tenant overlay is preferred over GLOBAL at
  resolve time, so a forked overlay missing `inbound` **downgrades the partner's ingress ack**
  to the generic `{status:'accepted'}`. A live behavior regression for any tenant that forked an
  inbound-enabled config, which is why "deliberately not forked" is implausible.

**Fix:** three conditional spreads on the fork's publish call, mirroring the publish path.

**No backfill.** Overlays already forked with fields dropped are healed by re-forking with
`?force=true` — precisely what force was built for (#519). Record that in the PR body.

**Workflow fork needs no change.** `forkGlobalToTenant` copies `manifest` verbatim
(`workflow.repository.ts:200`) and the declarations live inside the manifest JSON, so they
travel. Assert it once in the existing fork test rather than building anything.

## Part B — the resolved present/missing state has no SDK surface

`grep -rn "requirements" packages/workflows-sdk-python/pegasus_workflows/` returns only manifest
parsing plus two prose mentions. There is no client method and no CLI command; an external
author can reach `requirements-summary` only through the generic `api_get()` escape hatch. By
the SDK README's own rule ("a capability that exists in the API but isn't reachable +
discoverable through these is a gap, not a feature") that is a gap — and a conspicuous one now
that the tenant UI is built entirely on those two endpoints.

- `PegasusClient.requirements_summary()` and `.integration_requirements_summary()`. Both
  endpoints are already registered `apiKeyGet` on the m2m plane (`openapi-spec.ts:62`, `:201`),
  so `vnd_` tokens work and **no API change is needed**.
- CLI `pegasus-workflows requirements` merging both summaries, with `--missing-only`. Unlike the
  UI, which fails open by design, the CLI must **say which plane it could not read** when one
  403s rather than silently showing half the picture.
- Rewrite the prose that currently names the raw endpoint URL (README ~281 / ~550,
  `mcp_server.py:305` / `:467`) to name the new method + command. Otherwise the method ships and
  the discovery surfaces still point people at `api_get`.
- CHANGELOG + version 0.36.0.

## Part C — a discovery surface that never existed

Root CLAUDE.md and the SDK README (~1186) both name a `pegasus-workflows` CLAUDE.md as one of
the four discovery surfaces. `find . -iname CLAUDE.md` returns only the repo root file — it has
never existed. Per the user's decision: drop it from both lists so the named surfaces match
reality (README, MCP resources, CLI `--help`, OpenAPI). Grep repo-wide first; only two files are
confirmed so far.

## Traps

- **The usual gate does not test the SDK.** `packages/workflows-sdk-python` has no package.json,
  so turbo and `npm test` never touch it. Run pytest + ruff inside the package. The Python CI
  jobs that showed `skipping` on #607 will run on this PR.
- **apps/api coverage floor.** New api code + tests shift the line ratio; a 0.01% drop ejected a
  PR before. Run `vitest run --coverage` in apps/api with the worktree's DATABASE_URL — and note
  that integration tests skipping for a missing DATABASE_URL also drops below floor.
- **Publish sequencing.** The `sdk-python-v0.36.0` tag goes on the merge commit on synced `main`
  AFTER the PR lands — never on the branch, or PyPI points at a commit that never becomes main.

## Verification

apps/api vitest (+ coverage), SDK pytest + ruff, repo typecheck/lint. Then tag to publish.
