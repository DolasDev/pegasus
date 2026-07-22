# 0027 — outbound OAuth token cache: make the guarantee real (or make the docs honest)

**sdk-feedback:** `0027-oauth-token-not-cached-across-calls.md` — Status `Proposed`, filed 2026-07-18
against SDK 0.25.0.

## Verdict: still needed — but not the change 0027 asks for

0027's preferred fix (option 1: "cache the token server-side… keyed by (integration*id, group),
honor `expires_in` with a 60s skew, re-mint on 401 and retry once") is **already implemented**, and
landed in \*\*#444 (`e62cf3f9`, 2026-07-16) — two days \_before* 0027 was filed\*\*:

- `apps/api/src/services/outbound-oauth/index.ts` — `acquireOutboundToken` checks a cache, serves a
  hit while `expiresAt > now + 60s`, mints otherwise, stores `now + expires_in*1000` (fallback 300s).
- `apps/api/src/handlers/integration-call.ts:249-303` — builds the key, mints through the cache, and
  on a partner `401` calls `invalidateOutboundToken` → re-mints → retries **exactly once**.
- Unit tests already cover mint-and-cache, skew re-mint, invalidate-forces-re-mint, XML parsing.

So writing "the cache" again would be duplicate work. **The real gap is that the cache is a
per-container in-memory `Map`** (`const tokenCache = new Map(...)`, module scope) in the main API
Lambda (`app.ts:314`), which scales horizontally. Two sequential `call_external` calls are two
separate HTTP requests and can land on two different warm containers, each with its own empty Map —
so 0027's headline criterion ("two sequential calls → **one** token-endpoint hit") is **not
deterministically satisfiable** by the current design, even though the cache logic is correct.

This also explains why CI never caught it: the unit tests exercise one process, where the cache does
work. There is no test that can observe cross-container behavior.

Note the precedent 0027 cites — "the 0007 RingCentral token cache… generalize it" — is _also_ an
in-memory `Map` (`services/ringcentral/client.ts:32`). #444 generalized it faithfully, limitation and
all.

## What I have NOT proven

Container non-reuse is the most likely explanation for the observed 1→2→3 token hits, and it is a
real structural limitation regardless. But **I have not confirmed it is what actually happened on QA
on 2026-07-18.** Other candidates I could rule out by inspection (cache key is stable across the
three calls; `expires_in=600` parses; a parse failure would still cache for 300s), but not
"which container served each request". Phase 0 exists to settle that before building anything.

## Sequencing correction (2026-07-22, after approval)

Phase 0 as originally written — "measure the 2026-07-18 incident, then decide" — turns out to be
**impossible retroactively**, for two independently fatal reasons:

- **`integration-call.ts` contains zero `logger` calls.** There is no log line marking a
  `call_external` invocation at all, so the requester's three probe calls cannot be located in
  CloudWatch even though retention is `ONE_MONTH` (`api-stack.ts:260`) and 07-18 is still in window.
  The outbound-call path has _no_ production observability today — which is itself part of the finding.
- **No credentials for the hosting accounts.** The API deploys to `248812875460` (staging) /
  `331145994639` (prod) (`packages/infra/bin/app.ts:44-47`); the available profiles cover
  013200615444, 334317073943 and 949999885619 only.

**Revised approach — measurement ships _with_ the fix, but runs first.** One PR carries both, and the
L2 shared cache sits behind `OUTBOUND_OAUTH_SHARED_CACHE_ENABLED`, **default off** (the repo's
existing flag convention — cf. `INTEGRATION_CONFIG_PUBLISH_ENABLED`). That gives a real ordered
measurement in prod rather than a guess:

1. Deploy with the flag **off** → run the three-call probe → the new log line reports
   `outcome` + `instanceId` per call. Three distinct `instanceId`s with three `mint`s **confirms** the
   container-reuse diagnosis. One `instanceId` with three `mint`s **refutes** it, and the L2 work stays
   dark until the real cause is understood.
2. Flip the flag **on** → re-run the probe → expect one `mint` followed by `l2_hit`s, which is
   0027's acceptance criterion demonstrated in production.

The flag also de-risks the rollout: token caching across containers can be switched off instantly
without a redeploy if a partner turns out to reject reused tokens.

## Phase 0 — the instrumentation itself

Add cheap, permanent observability to the mint path, deploy, and re-run the requester's three-call
probe:

- `logger.info('outbound oauth token', { integrationId, tenantId, outcome: 'mint' | 'cache_hit',
reason: 'empty' | 'expiring' | 'invalidated', instanceId })` where `instanceId` is a module-scope
  random id (stable per container) — that single field makes container reuse directly observable.
- This is worth keeping regardless of which option we pick: today there is **no** signal
  distinguishing a mint from a hit in production.

**Decision gate:** if the probe shows one container and repeated mints, the diagnosis above is wrong
and the L2 cache stays flag-off — go back to reading the code. If it shows three container ids, flip
the flag on.

## Options

**A. Shared token cache (DB-backed L2).** New `OutboundOAuthToken` table keyed by
`(tenantId, integrationId, tokenUrl)` holding a KMS-encrypted token + `expiresAt`. Deterministically
one mint per token lifetime across all containers. Costs a DB round-trip (~5-20ms on Neon) plus a KMS
decrypt (~10-30ms) per call — against a token mint of ~100-500ms, still a clear win.

**B. Doc-only correction (0027's option 2).** Keep the in-memory cache; strike "caches" from the
`call_external` docstring (`api.py:1060`) and describe it as best-effort per-instance. Cheapest,
honest, and defensible given the Sirva spec's own "never reuse an expired token" guidance — but it
leaves the ADE load argument (N data calls → 2N round-trips against a rate-limited shared credential)
unanswered.

**C. Hybrid L1 + L2 (recommended).** Keep the in-memory Map as L1 (zero-latency on a warm container),
add the shared table as L2. Warm path costs nothing extra; cold/scaled-out path hits L2 instead of
the partner. This is the only option that satisfies 0027's criterion _and_ keeps the fast path fast.

**Recommendation: C**, contingent on Phase 0 confirming the diagnosis.

## Work breakdown (option C)

1. **Schema** — `OutboundOAuthToken`: `tenantId`, `integrationId`, `tokenUrl`, `tokenCiphertext`,
   `expiresAt`, `updatedAt`; unique on `(tenantId, integrationId, tokenUrl)`. Migration + `db:generate`.
2. **Repository** — `findFresh(key, now, skewMs)`, `upsert(key, ciphertext, expiresAt)`,
   `deleteKey(key)`. Thin, mockable, following `integration-config.repository.ts` shape.
3. **Service** — extend `acquireOutboundToken` to consult L1 → L2 → mint, writing through to both.
   Encrypt with `encryptSecretValue`/`decryptSecretValue` (KMS, per-tenant encryption context) —
   the precedent already used for `WorkflowSecretConfig` and runtime tokens. Keep `now`/`fetchImpl`
   injectable; add an injectable repo so unit tests stay I/O-free.
4. **Invalidation must clear BOTH tiers** — this is the subtle correctness point. `invalidateOutboundToken`
   after a `401` currently drops only the local Map; with L2 in play it must also delete the shared
   row, or the next container re-serves the token the partner just rejected. Also drop the stale L1
   entry on _other_ containers implicitly by having L1 entries carry the L2 `updatedAt` they were
   loaded from — or accept a bounded window (documented) rather than build cross-container eviction.
5. **Stampede** — several containers can mint concurrently on a cold L2. Accept it: upsert is
   last-write-wins and a duplicate mint is harmless. Do **not** add a lock; the complexity is not
   justified by the load. Say so in a comment so the next reader doesn't "fix" it.
6. **Docs** — update the `call_external` docstring to state precisely what is guaranteed (shared,
   honors `expires_in` less a 60s skew, one re-mint + one retry on `401`), plus the MCP
   `pegasus://reference/*` text if it repeats the claim. This is required under either option.

## Tests

- Service unit tests with a fake repo: L1 hit (no repo call), L1 miss → L2 hit (no mint), both miss →
  mint + write-through, expiry/skew re-mint, `401` invalidation clears both tiers.
- Handler test: two `call_external` calls **through separate simulated container instances** (reset
  the L1 Map between them, share the fake repo) produce **one** mint — the closest in-process analog
  of 0027's acceptance criterion, and the test the current suite structurally cannot express.
- Integration test against the worktree Postgres for the repository round-trip.
- Coverage floors will auto-raise; re-pin per the usual merge-queue dance.

## Mapping to 0027's acceptance criteria

| Criterion                           | Under option C                               |
| ----------------------------------- | -------------------------------------------- |
| Docs and behavior agree             | ✅ docstring rewritten to the real guarantee |
| 2 sequential calls → 1 mint         | ✅ deterministic via L2                      |
| `401` → exactly one re-mint + retry | ✅ already built; extended to clear L2       |
| Re-mint after `expires_in`          | ✅ already built (60s skew)                  |

The last criterion (doc-only path) becomes moot unless we choose B.

## Risks

- **Storing partner access tokens at rest** widens the blast radius of a DB compromise. Mitigated by
  KMS encryption with a per-tenant encryption context, matching existing precedent — but it is a real
  change in posture and worth an explicit yes/no from you.
- **Latency on the L2 path** if KMS decrypt is slower than assumed; measure in Phase 0's probe.
- A partner that genuinely forbids token reuse would be harmed by caching. 0027 anticipates this with
  an `AUTH_TOKEN_CACHE = on|off` per-integration flag; I'd defer it until a partner actually needs it
  rather than ship an unused knob.

## Out of scope

- Migrating the RingCentral cache to the same shared store (same limitation, separate change).
- Editing `sdk-feedback/0027-*.md` or 0022's criteria — the requester owns validation and status.
- Any SDK version bump: under option C the SDK change is docstring-only, so it rides the next release
  rather than justifying one.

## Open questions for you

1. **Phase 0 first, or go straight to building C?** I'd rather measure — the whole plan rests on a
   diagnosis I can't fully confirm from the code.
2. **Is KMS-encrypted token-at-rest acceptable**, or do you want the in-memory-only posture kept and
   the docs corrected instead (option B)?
3. **Is this worth doing at all right now?** No workflow is known to be hurting from it today; the
   concrete driver is ADE's rate-limited shared credential under `ade_shipment_detail_sync`.
