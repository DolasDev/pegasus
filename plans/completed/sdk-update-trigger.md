# SDK `update_trigger` + `schedule disable|enable` (SDK 0.45.0)

- **Branch:** `feat/sdk-update-trigger`
- **Asked:** 2026-10-05, by the user ("add update_trigger to the SDK") right
  after the prod trigger `0f17a3a8` had to be disabled with a raw httpx PATCH,
  because the SDK only had create/list/delete.
- **Status:** done in this PR.

## Gap

`PATCH /api/v1/workflows/:id/triggers/:triggerId` existed (partial update:
`enabled`, `eventType`/`filter` for EVENT, `cronExpression` for SCHEDULE; `kind`
immutable, strict body), but it wasn't reachable or discoverable through the SDK,
the CLI or OpenAPI. Under the CLAUDE.md "SDK is the product boundary" rule, that's
a gap. The only SDK way to stop a trigger was to delete it.

## Done

1. `PegasusClient.update_trigger(workflow_id, trigger_id, *, enabled=,
event_type=, filter=, cron_expression=)`. It sends only the fields given
   (`enabled=False` is sent, not dropped). With no fields it raises `ValueError`
   locally. The harness classifies it as `_IGNORED`, like its trigger siblings.
2. CLI `pegasus-workflows schedule disable|enable <workflow> <trigger-id>`. It
   works for any kind: the PATCH is kind-agnostic for `enabled`.
3. OpenAPI: documented PATCH and DELETE on `/workflows/{id}/triggers/{triggerId}`
   (only the GET was there before).
4. Docs: README (CLI table and trigger section), MCP guide (Shape 4), CHANGELOG
   0.45.0, version bump.

## Not done (deliberately)

- Clearing a `filter` (setting it to null) isn't supported by the API's
  validation, so it isn't offered.
- `schedule list` still shows only SCHEDULE triggers. Listing EVENT triggers from
  the CLI is a separate gap; `PegasusClient.list_triggers` returns all kinds.

## After merge

Tag `sdk-python-v0.45.0`, confirm it on PyPI, and update
`~/repos/pegasus-workflows/CLAUDE.md` (its trigger section).
