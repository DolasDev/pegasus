# Plan: SDK completeness — P2 accessors + P3 docs (discoverability punch-list)

Close the P2/P3 items from the post-#459 discoverability audit. Mostly **SDK-only**
additions (the endpoints + Cedar grants already exist on the m2m router); **one**
tiny platform route for the integration-config list.

## P2 — missing SDK accessors

Verified: the routes + persona grants already exist and are m2m-reachable, EXCEPT
the integration list (Cognito-only).

1. **`cancel_execution(workflow_id, execution_id)`** → `POST /api/v1/workflows/{id}/executions/{eid}/cancel` (gated `CancelWorkflowExecution`, granted to `workflow_developer`; handler on m2m). SDK-only.
2. **`retry_execution(workflow_id, execution_id)`** → `POST .../retry` (`RetryWorkflowExecution`, workflow_developer). SDK-only.
3. **`fork_integration_config(integration_id)`** → `POST /api/v1/integrations/{id}/config/fork` (gated `PublishIntegrationConfig`, granted to `integration_publisher`; on m2m). SDK-only.
4. **`get_mapping_schema()`** → `GET /api/v1/integrations/mapping-schema` (public). **`get_inbound_schema()`** → `GET /api/v1/integrations/inbound-schema` (public). Live-introspection accessors (the principle in root CLAUDE.md). SDK-only.
5. **`list_integrations()`** → the tenant's configured integration ids. `GET /api/v1/integrations` is **Cognito-`v1`-only** — a vnd\_ key can't reach it. **Platform change:** add `GET /integrations/configs` to the m2m `integrationConfigHandler` (gated `ReadIntegrationConfig`, granted to `integration_publisher`), reusing the same repo list the Cognito handler uses. Distinct path (`/integrations/configs`, not bare `/integrations`) so it does NOT shadow the browser list (dual-auth falls through to Cognito). No Cedar change.

All go on the existing personas' grants — **no Cedar policy changes.**

## P3 — docs

- **README** — add short subsections/examples for the surfaces the audit found undocumented:
  - the `schedule` CLI sub-app (create/list/delete cron triggers) — currently unmentioned;
  - `emit_event(name, payload)` (custom-event chaining) — only in a testing example today;
  - pegII orders/tasks reads (`list_orders`/`get_order`/`list_tasks`/`get_task`/`close_task`);
  - a one-liner for `fork_workflow` + EVENT-kind triggers.
    Plus the new P2 methods (executions cancel/retry, fork-config, schema getters, list_integrations).
- **Thin docstrings** (render sparse in MCP `pegasus://reference/api`): flesh out `list_workflows`, `get_workflow`, `list_triggers`, `delete_trigger`, `download_artifact` with Args/Returns/Raises.
- **OpenAPI** — add the new SDK-relevant paths: `/workflows/{id}/executions/{eid}/cancel|retry`, `/integrations/{id}/config/fork`, `/integrations/configs`, and the two public schema GETs.
- **CHANGELOG** + version bump → SDK **0.24.0**.

## Tests

- API: one test for the new `GET /integrations/configs` m2m route (returns ids for `integration_publisher`, 403 without, tenant-scoped). Coverage above floors; no autoUpdate floor raise.
- SDK: unit tests that each new method hits the right path/verb (mocked transport), incl. `list_events` untouched; `list_integrations` list shape; schema getters return the fetched JSON.
- Typecheck + ruff clean; SDK pytest green.

## Out of scope

- Reworking inventory reads (needs a deliberate ReadInventory action + grant — separate).
- Any Cedar policy/action change (none needed here).

## Acceptance

Every P2 capability is callable from `PegasusClient` with the appropriate key, and
each new method + the previously-undocumented surfaces (schedule, emit_event,
orders/tasks) appear in README + MCP `reference/api` + OpenAPI. The discoverability
punch-list is cleared except the explicitly-deferred inventory item.
