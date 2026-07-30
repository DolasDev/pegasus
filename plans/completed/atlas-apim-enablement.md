# Atlas APIM enablement — outbound header + resilience gaps

**Motivation:** `docs/atlas-world-group-api/` (research, 2026-07-30). Atlas World Group publishes
24 APIs / 255 operations behind Azure API Management. **Zero of them are callable from a Pegasus
workflow today.** Two compounding gaps in `call-external`, plus three resilience gaps that any
polling integration against an APIM gateway needs.

This plan covers tiers 1–2 of the research doc's §4 sequencing. Tiers 3–5 (multipart, >5 MB
streaming, new floors, richer rule operators) are explicitly **out of scope** — see "Deferred".

---

## Gaps addressed

| Id  | Gap                                                                                                                               | Evidence                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| G1  | `AUTH_MODE` has no API-key mode; Atlas's only credential is the `Ocp-Apim-Subscription-Key` **header**                            | `apps/api/src/handlers/integration-call.ts:219,232,276,285` |
| G2  | `call-external` can send **no** caller-supplied header, so the `On-Behalf-Of` header that 142/255 Atlas ops declare is unsendable | `integration-call.ts:124-155,230,304`                       |
| G2b | `deliver-to-external`'s `headersConfig` reads a **plaintext CONFIG** row — wrong place for a credential                           | `integration-delivery.ts:58,153-166`                        |
| G5  | Response headers discarded (only `content-type`), losing `Retry-After`, `x-ms-request-id`, `ETag`                                 | `integration-call.ts:355,367`                               |
| G6  | No request timeout; no 429/503 retry                                                                                              | `integration-call.ts:306-327`                               |

---

## Design

### 1. `apikey` AUTH_MODE (G1)

New `AUTH_MODE` value `apikey`. Reads:

- `CONFIG API_KEY_HEADER` — header name, default `Ocp-Apim-Subscription-Key`
- `SECRET API_KEY` — the key value (reuses the existing bearer secret key name)

Sets `headers[API_KEY_HEADER] = <decrypted secret>`. Key names overridable per call, same as every
other config/secret reference on this endpoint.

Rationale for a distinct mode rather than folding into `bearer`: the header name is not
`Authorization` and there is no `Bearer ` prefix, so reusing `bearer` would need a sentinel. A named
mode is self-documenting and appears in the published `AUTH_MODE` enum.

### 2. Header passthrough (G2)

Two additions to `CallBody`, deliberately split by trust level:

- **`headers`** — `Record<string, string>`, caller-supplied **non-secret** headers (e.g.
  `On-Behalf-Of: jdoe`). Values come from workflow code, so they must never be credentials.
- **`secretHeaders`** — `Record<string, string>` mapping **header name → SECRET key name**. The
  platform resolves each from the encrypted store, so the credential never enters workflow code.
  This is the mechanism that keeps the "credentials never touch workflow code" invariant intact.

**Reserved-header guard:** reject (400) any attempt to set `Authorization`, `Host`, `Content-Length`,
or `Content-Type` via either map — those are owned by the handler and letting a workflow override
`Authorization` would sidestep `AUTH_MODE` entirely. Case-insensitive.

Bound both maps (≤ 24 entries, name ≤ 128 chars, value ≤ 4096) so a workflow can't build an
unbounded request.

Precedence: handler defaults → `headers` → `secretHeaders` (secrets win, so a non-secret entry can
never shadow a resolved credential).

### 3. `deliver-to-external` symmetry (G2b)

Add the same `headers` / `secretHeaders` to `deliver-to-external`. Keep `headersConfig` working
(back-compat) but document it as non-secret-only. Share the header-building logic between the two
handlers rather than duplicating it.

### 4. Full response headers (G5)

Return every response header as a lowercase-keyed object instead of just `content-type`. Applies to
both the inline and `responseToBlob` branches, and to `deliver-to-external`.

Redaction: strip `set-cookie` (session material, never useful to a workflow, and a leak risk if a
workflow logs the response).

### 5. Timeout + retry (G6)

- **Timeout:** `AbortSignal.timeout(ms)`, from `CONFIG REQUEST_TIMEOUT_MS`, default 30 000,
  clamped to [1 000, 60 000] (the API Lambda's own ceiling bounds anything larger). Abort surfaces
  as `504 UPSTREAM_TIMEOUT`, distinct from the existing `502 UPSTREAM_ERROR`.
- **Retry:** on 429 and 503, honor `Retry-After` (delta-seconds or HTTP-date) capped at 10 s, up to
  `CONFIG MAX_RETRIES` attempts (default 2, clamp [0, 5]). Fall back to exponential backoff when the
  header is absent. **Retry only idempotent requests** — GET/HEAD, or any call with
  `mutating: false`. A POST that we don't know to be safe is never auto-retried.
- Report `attempts` in the response so a workflow can see it was throttled.
- Keep the existing single OAuth-401 re-mint; it composes ahead of this loop.

---

## Work plan (TDD — test first at each step)

1. **`lib/outbound-headers.ts`** — new shared module: reserved-header guard, bounds validation,
   secret resolution, precedence merge. Unit tests for every rejection path.
2. **`lib/outbound-retry.ts`** — new shared module: `Retry-After` parsing (delta-seconds + HTTP-date
   - garbage), backoff computation, idempotency predicate. Pure + unit-tested; no I/O.
3. **`integration-call.ts`** — wire in `apikey` mode, both header maps, full response headers,
   timeout, retry. Handler tests with a stubbed fetch.
4. **`integration-delivery.ts`** — header symmetry + full response headers. Handler tests.
5. **OpenAPI** — document the new request fields, the `AUTH_MODE` enum, and the 504. The repo's
   openapi coverage test fails CI on undocumented m2m routes, so this is mandatory, not optional.
6. **SDK** (`packages/workflows-sdk-python`) — `headers` / `secret_headers` / `timeout_ms` params on
   `call_external` and `deliver_to_external`; docstrings covering the reserved-header rule, the
   "secrets go in `secret_headers`" rule, and retry semantics. Bump minor version.
7. **SDK discovery surfaces** — README, `pegasus-workflows` CLAUDE.md, MCP `pegasus://reference/*`
   resources. Per root CLAUDE.md: a capability reachable in the API but not discoverable through the
   SDK is a gap, not a feature.
8. **Research doc** — mark G1/G2/G2b/G5/G6 closed in `docs/atlas-world-group-api/README.md`.
9. Full `npm test` + `npm run typecheck`, then one PR through the merge queue.
10. **After merge:** push the `sdk-python-v<version>` tag to trigger `release-sdk-python.yml` → PyPI.

---

## Deferred (explicitly not in this PR)

- **G3 multipart/form-data** — 12 ops, all `assetmanagement-v1`. Needs a request-body encoding
  design; no business case identified yet.
- **G4 >5 MB documents** — `INLINE_BLOB_MAX_BYTES`. Real streaming is a separate infra spec.
- **G7 new floors** — `estimate/quote`, `survey_inventory`, `claims`, `customer_master`,
  `tariff/rating`. Each is a platform PR _and_ a domain-modeling decision about which Atlas domains
  we actually integrate. Needs a product call first.
- **G8 rule operators / mapping expressions** — revisit only when a concrete mapping proves
  unexpressible.
- **OAuth `scope`/`resource`** — irrelevant to Atlas (no OAuth in their catalog); still a real gap
  for a future Entra-fronted partner.

## Risks

- **Reserved-header guard is the security boundary of this change.** If `Authorization` can be
  overridden via `headers`, a workflow bypasses `AUTH_MODE`. Test this explicitly, both cases and
  mixed case.
- **Retrying a non-idempotent call would double-write at a partner.** The idempotency predicate must
  default to _not_ retrying anything it isn't sure about.
- **SSRF posture is unchanged** — `assertDeliverableUrl` still runs on the resolved URL. Adding
  headers does not widen it.
