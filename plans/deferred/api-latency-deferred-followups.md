# API p99 Latency — Deferred Follow-ups

> **Deferred from** `plans/completed/24e9698-api-p99-latency-remediation.md` (the active work —
> Phases 1–3 + saved Logs-Insights queries — is shipped & deployed to prod). These two items are
> **event-gated**, not abandoned: each has a concrete trigger that should bring it back into an
> active plan. **Spun out 2026-06-15.**

---

## 1. Aggressive client-timeout budget (Phase 2 tightening) — _data-gated_

**State:** the Phase 2 _mechanism_ shipped (`24e9698`): every downstream now fails with a typed,
logged error before the 29 s Lambda wall. The ceilings are deliberately **conservative** — relative
to each call's own declared `timeoutMs` (or the 15 s default) + 4 s overhead, capped at 27 s; Neon
`statement_timeout=25 s` + `connectionTimeoutMillis=20 s`. They cannot break a legitimately-slow
query, but they are **not** the aggressive 5–8 s fast-fail the plan contemplated.

**Why deferred:** finalizing a 5–8 s budget without data risks failing legitimate slow paths
(reports, bulk reads, Neon autosuspend resume). The plan requires real downstream timings first.

**Trigger to resume:** the next > 10 s event (the `[~]` acceptance item on the parent plan). When it
fires, run the saved query **`pegasus/api-slow-requests`** to read the real db/mssql/tunnel/
unattributed breakdown and the legitimate-query ceiling.

**Then:**

1. Set tighter per-call `timeoutMs` defaults (or a global floor) at or just above the observed
   legitimate p99 per downstream.
2. **Validate in staging first** — confirm reports / bulk reads / cold-resume complete under the new
   budget before prod.
3. Files: `apps/api/src/lib/mssql-executor-client.ts`, `apps/api/src/lib/tunnel-client.ts`,
   `apps/api/src/db.ts` (and the shared `apps/api/src/lib/invoke-timeout.ts`).

---

## 2. Phase 4 — provisioned concurrency (cold-start removal) — _not-recommended; quota-gated_

**State:** not implemented. User-approved hold 2026-06-15.

**Why deferred:**

- It removes the 2.6–4.4 s cold starts but does **not** address the warm-request root cause (the
  16.8 s / 29 s incident was warm) — so it does not fix this incident.
- It is the one costly item: ~**$5.40 / unit / month**, continuous (512 MB).
- **Contraindication (the real blocker):** PC reserves from the account concurrency pool, and **both
  accounts are capped at an unraised limit of 10** (`L-B99A9384`). The api Lambda _synchronously_
  invokes the executor / tunnel Lambdas from that same pool (see the existing AppGuard self-throttle:
  drivers-500 / zones-503). Reserving PC units would tighten that budget and likely **worsen** the
  throttle.

**Trigger to resume:** cold-start p99 becomes a _distinct_ product complaint (separate from the warm
tail this plan addressed).

**Correct order when resumed (do NOT skip step 1):**

1. Raise the Lambda "Concurrent executions" quota (`L-B99A9384`) on **both** accounts
   (staging `248812875460`, prod `331145994639`).
2. Then wire PC: publish a version + `live` alias on `ApiFunction`, retarget the
   `HttpLambdaIntegration` (`api-stack.ts`) from `$LATEST` to the alias, set
   `provisionedConcurrentExecutions` (start at 1) with utilization autoscaling. Note each deploy
   publishes a new version → the alias shifts and PC re-warms (a brief deploy-time cold window).

Related context: cold-start profile and the concurrency-cap mechanics are in the parent plan's
Context / Findings sections and the `project_lambda_concurrency_throttle` memory.
