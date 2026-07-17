# Spec: SDK read passthrough (`api_get`) + OpenAPI widening + route-coverage enforcement

**Goal:** retire "reachable-by-a-`vnd_`-key but not in the SDK" as a recurring _read_ gap category. One escape hatch for arbitrary GETs, a widened OpenAPI spec so those GETs are discoverable, and a **test that keeps the spec complete** so the gap can't silently reopen. Typed methods stay the front door for writes and in-workflow reads (dry-run + offline-harness safety).

Motivating gap that this closes for free: the 0026 projection read-model (`GET /integrations/:id/projections/:entityType[/:key]`, `?status`/`?updatedSince`/keyset paging) — plus any future read.

## Part A — `PegasusClient.api_get(path, **params)` (SDK)

A thin, authenticated, **read-only** passthrough to the Pegasus API using the caller's key.

```python
def api_get(self, path: str, **params: Any) -> Any:
    """GET any Pegasus API path with the caller's key; returns the full JSON body.

    An escape hatch for read endpoints without a dedicated helper (see the OpenAPI
    spec / pegasus://reference/openapi for the catalog). Read-only by design — for
    writes use the typed methods, which route through the dry-run capture path.
    """
```

Semantics + guardrails:

- **GET only.** No `api_post`/`api_request` — a generic write would bypass `_capture_mutation` and silently break dry-run/offline rehearsal. Writes keep their typed methods. (A future write-opt-in is an explicit non-goal here.)
- **Path, not URL.** `path` must start with `/` (e.g. `/api/v1/integrations/x/projections/shipment`). Reject anything with a scheme/host → no SSRF; arbitrary _partner_ hosts remain `call_external`'s job. Same `_client()` (bearer + base_url + timeout) as every typed read.
- **Returns the whole body** (`response.json()`), NOT `["data"]` — so the caller sees `meta` / `nextCursor` / bare-schema envelopes. Raises `PegasusApiError` on non-2xx (reuse `_get_json`'s error path; `api_get` can just be `return self._get_json(path, **params)` with the leading-`/` guard).
- **Auth:** works with any key incl. `from_runtime()` — so a reconciliation _workflow_ or an ops script both use it.

Testing-harness classification:

- Put `api_get` in **`_IGNORED`** (the "not the in-activity offline-rehearsed surface" bucket, alongside the CLI/execution-inspection methods). Rationale: it has no method-name→fixture mapping, and its consumers are ops/reconciliation on a real client, not offline-stubbed in-activity code.
- `FakeClient.api_get` raises a clear, named error ("api_get is not stubbed in the offline harness — use a typed read helper, or a real client"). Keeps the anti-drift union green and gives an author an actionable message instead of an `AttributeError`.
- SDK unit tests (`test_api.py`): asserts it GETs the given path with params, returns the full body, and rejects an absolute URL (`ValueError`).

Docs/MCP:

- Auto-surfaces in `pegasus://reference/api` (public method).
- README: a short "Calling a read endpoint directly (`api_get`)" subsection under the runtime-reads area — the 0026 projection query is the worked example (`status`/`updatedSince`/`nextCursor`), plus the "writes use typed methods" caveat and a pointer to `reference/openapi`.
- **Optional (nice-to-have, may drop):** a `pegasus-workflows api get <path> [--query k=v]` CLI command for terminal debugging.

## Part B — Widen the served OpenAPI spec (`apps/api/src/lib/openapi-spec.ts`)

Today the spec is deliberately scoped to the authoring surface. Widen it to cover the **full `vnd_`-reachable (m2m) surface** so `api_get` targets are discoverable.

- **Enumerate + fill** every route on the m2m plane (the `m2mV1` router + dual-auth handlers): `/events`, `/event-types`, `/orders`, `/pegii/*`, `/workflows/*` (executions/triggers/cancel/retry/fork/download-url), `/sms`, `/workflow-secrets-configs/*` (secrets+configs runtime + strict), `/integration-projections/runtime/*` **and** `/integrations/:id/projections/*` (0026), the `/integration-validation` family (validate, config, map-to, map-from, fork), `/blobs/*`, ingress-management, `/runtime/*`, `/integrations/configs`, floors, schemas. Prioritize **GET** routes (what the passthrough needs); writes can fill in incrementally.
- Reuse Zod via `z.toJSONSchema` where request/response schemas exist; hand-fill path/verb/params/auth otherwise. Keep it one generator module.
- Update `info.description`: from "SDK-relevant authoring surface" → "the SDK-facing `vnd_`/m2m API surface" and note worker-internal (broker-secret) + Cognito-only browser routes are intentionally excluded.

## Part C — Route-coverage test (the durable centerpiece)

This is what makes the widening _stay_ complete — without it, a hand-written spec decays and the gap silently reopens.

- New test (`apps/api/src/lib/openapi-spec.coverage.test.ts`): introspect the assembled `m2mV1` router's registered routes (Hono exposes `.routes` as `{method, path}`), normalize `:param`→`{param}`, and assert **every m2m `GET` route** has a matching path+method in the served OpenAPI spec.
- An explicit **allowlist** of intentionally-undocumented routes (worker-internal broker-secret endpoints, anything deliberately private) — each entry commented with why. A new undocumented m2m GET route then **fails CI** until it's either documented or allowlisted — the lockstep enforcement the "keep SDK in sync" principle has been asking for.
- Scope decision: enforce **GET** coverage first (matches the read-passthrough goal and is the tractable slice). Extending the test to writes is a follow-up once the read side is green.
- **Feasibility note / fallback:** if Hono's post-assembly route introspection proves too noisy to filter m2m-vs-Cognito cleanly, fall back to introspecting each m2m handler's own `.routes` before mounting (each handler is its own Hono instance) and compose the mount prefixes — still code-derived, no hand-maintained route list. Only if _both_ prove intractable do we drop to a commented manifest (and say so loudly).

## Non-goals

- A generic **write** passthrough (would bypass dry-run capture). Writes stay typed.
- Documenting Cognito-only browser routes or worker-internal endpoints (not `vnd_`-reachable → not the SDK's surface).
- `query_projections()` as a one-off — subsumed by `api_get` + the spec entry.

## Delivery

One PR (SDK + API): `api_get` + tests + README/MCP; OpenAPI widening; the route-coverage test + allowlist. SDK **0.25.0**. Coverage above floors; no autoUpdate floor raise.

## Acceptance

1. `client.api_get("/api/v1/integrations/sirva_ade_shipment/projections/shipment", status="REGISTERED", limit=50)` returns the 0026 read-model page (`{data, nextCursor}`) — no typed method needed.
2. `api_get` rejects an absolute URL and a non-GET intent (it only does GET).
3. The route-coverage test passes, and adding a new undocumented m2m GET route makes it **fail** until documented/allowlisted.
4. `pegasus://reference/openapi` now lists the full `vnd_`-reachable read surface.
