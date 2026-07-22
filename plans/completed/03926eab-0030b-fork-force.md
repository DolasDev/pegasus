# 0030 part B — `fork --force` refreshes a tenant overlay from GLOBAL

**sdk-feedback:** `0030-no-delete-or-replace-for-tenant-config-overlay.md` (part B).
Part A (delete a tenant overlay) and all of 0031 (retire a GLOBAL) shipped in #509 /
SDK 0.29.0 — this closes the last open half.

## Disposition note (mid-implementation)

While this was being built the requester validated **both** items and closed 0030 with:
_"the `fork(force=)` variant wasn't built and isn't needed (delete + re-fork covers it)."_
Shipped anyway, deliberately, because delete + re-fork is **not** equivalent: `delete`
hard-drops the entire version lineage (irreversible, `rollback` gone, re-publish restarts
at v1) and is two calls with a window where the tenant resolves GLOBAL live, whereas a
forced fork supersedes and keeps the pre-refresh overlay rollback-able. The CLI `fork`
verb is an independent discoverability gap — fork was `PegasusClient`-only.

## Problem

`POST /integrations/:id/config/fork` refuses with `409 CONFLICT` when the caller's
tenant already owns a TENANT overlay. So a tenant that forked a platform default once
can never re-sync it: fork is one-shot, and the only workaround is hand-republishing a
copy that then never tracks GLOBAL. Delete-then-fork (0030A) works but destroys the
whole overlay lineage — history and `rollback` go with it.

## Change

**API** — `apps/api/src/handlers/integration-validation/config.ts`

- Accept `?force=true` on the fork route (same query convention as the DELETE verb).
- When an own overlay exists: 409 as today unless `force`, in which case fall through
  and re-fork. `repo.publish()` already supersedes prior PUBLISHED rows and bumps the
  version, so the refresh is a **new tenant version with fork provenance**, not a
  delete — `versions`/`rollback` keep working and the tenant can back out. This is
  what 0030B asks for ("a new tenant version", carrying fork provenance).
- `force` with no existing overlay behaves exactly like a plain fork (no error).
- Gate re-runs against the current floor unchanged, so a refresh can't resurrect a
  now-invalid GLOBAL.
- Log line gains the superseded version so a refresh is distinguishable from a seed.
- `apps/api/src/lib/openapi-spec.ts`: document the `force` query param + 409 response.

**SDK** — `packages/workflows-sdk-python`

- `PegasusClient.fork_integration_config(integration_id, *, force: bool = False)` —
  passes `?force=true`; docstring covers refresh-vs-seed and how it differs from
  `delete_integration_config` (refresh keeps history, delete drops the lineage).
- New CLI verb `integration-config fork <id> [--force] [--yes]`, mirroring
  `delete_command`'s confirm prompt (a `--force` refresh overwrites what the tenant
  is currently resolving). Fork has **no** CLI surface today at all, so this also
  closes a discoverability gap.
- Version bump 0.29.0 → 0.30.0 + CHANGELOG entry.
- Anti-drift: `fork_integration_config` is already in `testing/__init__.py` `_MUTATIONS`
  and the `_MUTATION_CALLS` parity list — update the parity lambda if the signature
  change trips it.

**Discovery surfaces** (CLAUDE.md rule: SDK is the external product boundary)

- SDK `README.md` CLI table + the integration-config walkthrough: add `fork` (both
  forms) next to `delete`.
- SDK `CLAUDE.md` and `cli/mcp_server.py` `pegasus://reference/integration-config`
  resource text: same addition.

## Tests

- `apps/api/.../config.test.ts` — (a) existing overlay + `force=true` → 201, version
  is `prior + 1`, `forkedFrom*` stamped from the current GLOBAL, prior row SUPERSEDED;
  (b) existing overlay without `force` → still 409; (c) `force=true` with no overlay →
  201 v1; (d) `force=true` still 422 when the GLOBAL fails the current gate; (e)
  platform tenant + `force` → still 400 `PLATFORM_TENANT_CANNOT_FORK`.
- SDK `tests/test_api.py` — `force=True` sends `?force=true`, default sends no param.
- SDK CLI test for the new `fork` command (confirm prompt + `--yes`).
- OpenAPI coverage test already fails CI on undocumented routes — spec edit keeps it green.

## Out of scope

- Changing default fork behavior (409 stays the default — additive only).
- Removing the `demo_partner` built-in overlay from `registry.ts` (a separate code change,
  noted in the #509 gotchas).
- Editing the `~/repos/pegasus-workflows/sdk-feedback/*.md` status lines — the requester
  validates and flips those, not this session.

## Ship

Branch `feat/0030b-fork-force` → one PR → merge queue. Then push tag
`sdk-python-v0.30.0` to publish the SDK to PyPI (publishing the SDK is platform work).
