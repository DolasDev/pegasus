# API Lambda p99 Latency — Incident Investigation & Remediation

> **Status: PHASE 1 + PHASE 3 IMPLEMENTED (branch `feat/api-latency-diagnostics`, PR open)** — 2026-06-13
> Phase 1 (X-Ray active tracing + per-downstream `captureAWSv3Client` subsegments, API Gateway
> access logging with `integrationLatency`, structured `request.completed` per-request log line with
> a db/mssql/tunnel ms breakdown) and Phase 3 (p99 alarm de-flapped to a 2-of-3 five-minute window)
> are built, tested (infra 300 + api 1731 green), and shipping. **Phase 2 (client timeouts) is
> deliberately NOT in this change** — the plan gates it on real downstream timings from Phase 1, which
> only exist once this is deployed and the next spike is observed; finalise the 5–8s budget against
> that data and ship to staging first. **Phase 4 (provisioned concurrency) remains deferred** — it does
> not address the warm-request root cause.
> **Original scope below — 2026-06-12.**
> **Trigger:** CloudWatch alarm `pegasus-lambda-duration-p99` fired `OK → ALARM` at 2026-06-12 15:23 UTC (one datapoint, 16,764 ms p99 > 10,000 ms threshold), auto-cleared to `OK` at 15:26 UTC.
> **Related:** `plans/in-progress/audit-observability-alerting.md` owns alarm **routing** (SNS subscribers), alarm-coverage gaps, and saved Insights queries. This plan does **not** re-cover those — it covers the **latency root cause** and the **instrumentation gaps that made today's spike un-diagnosable**. Coordinate the CDK edits since both touch `monitoring-stack.ts` / `api-stack.ts`.

## Context

The alarm watches `AWS/Lambda Duration` p99 for `pegasus-prod-api-ApiFunctionCE271BD4-6VvoKdozISxQ` (account `331145994639`, us-east-1), the single Lambda behind the HTTP API "Pegasus Move Management API" (`srz4fc9bq7`, route `ANY /{proxy+}` → monolithic handler). Investigated read-only via the `dolas-pegasus-prod-ro` SSO profile.

### What happened (measured, not inferred)

| Time (UTC)   | Event                                                                        |
| ------------ | ---------------------------------------------------------------------------- |
| 15:17:45     | Function deployed (`LastModified`)                                           |
| 15:16–15:21  | Cluster of **cold starts**, total 2.6 s–4.4 s, Init Duration ~1.6–1.9 s each |
| 15:20:58.913 | RequestId `15a4562f-1516-4f87-b215-9a6bcd6dbffb` **starts**                  |
| 15:21:15.741 | …**ends 16,827 ms later** — emitting _zero_ log lines between START and END  |

5-minute Duration buckets (15:00–15:30): p50 stayed **10–34 ms** the entire time; the tail spiked to 2.6 s (15:05), 4.1 s (15:15), and **16.8 s (15:20)**. **Zero errors, zero throttles.** API Gateway `IntegrationLatency` for the 15:20 bucket was 16,840 ms — i.e. the time was spent **inside the Lambda waiting on a downstream call**, not in gateway overhead. Max memory used was 287/512 MB (not memory-bound).

The breaching request was **warm** (no Init Duration), so it was **not** a cold start, and the 15:17:45 deploy only produced the benign 2.6–4.4 s cold-start cluster — neither is the cause of the 16.8 s datapoint.

### This is a recurring tail event, not a one-off

Daily **max** Duration over the trailing 14 days (daily p99 stays sub-second to ~3 s the whole time):

| Day       | max Duration                                                                    |
| --------- | ------------------------------------------------------------------------------- |
| May 29    | 20.4 s                                                                          |
| **Jun 1** | **29.0 s** ← equals the 29 s Lambda timeout; that day also logged **46 Errors** |
| Jun 2     | 15.9 s                                                                          |
| Jun 5     | 15.1 s                                                                          |
| Jun 12    | 16.8 s (this incident)                                                          |

Every few days a single request blocks 15–29 s. On **Jun 1 it hit the 29 s timeout exactly** — meaning that class of slow request has already caused real failures; today's just came in under the wire.

### Findings (each verified against live AWS state + CDK source)

1. **Root cause is an un-instrumented slow downstream call, not Lambda itself.** The handler is non-VPC (`VpcConfig` empty) and reaches three downstreams (`packages/infra/lib/stacks/api-stack.ts`): **Neon Postgres** over the public internet (`DATABASE_URL`, secret `pegasus/{env}/database-url`, :194–198, :247); **tenant MSSQL** via `grantInvoke` of `MssqlExecutorFn` (:630–642, client `apps/api/src/lib/mssql-executor-client.ts`); and the **WireGuard tunnel** via `TunnelProxyFn` (:617–628, client `apps/api/src/lib/tunnel-client.ts`). A stall in any of these — Neon serverless compute resume, a slow tenant SQL query, or a tunnel hiccup — produces exactly this signature (rare 15–29 s block, no local error, nothing logged). We **cannot currently tell which** because of findings 2–4.
2. **No X-Ray tracing** (`api-stack.ts` ApiFunction :239–328 has no `tracing` prop → defaults to PASS_THROUGH; confirmed live `TracingConfig: PassThrough`). No service map, no per-downstream segment timings — the single biggest reason this incident is a black box.
3. **No API Gateway access logging** (`api-stack.ts` :1286–1319: `HttpApi` + `$default` stage set `defaultRouteSettings` throttling but no `AccessLogSettings`; confirmed live `accessLogArn: null`). With a single `ANY /{proxy+}` route there are no per-route metrics either, so we can't even learn _which endpoint_ was slow.
4. **No per-request application logging on the slow path.** The 16.8 s request logged nothing but the platform START/END/REPORT lines (LogFormat `Text`, custom log group `pegasus-prod-api-ApiLogGroup1DEDFC07-Eh536UmPkUJ5`, `api-stack.ts` :202–205, :327). No route/method/duration/downstream-timing line exists to correlate.
5. **No client-side timeout budget.** The 29 s Lambda timeout (`api-stack.ts` :239–328) is the only ceiling, and it equals the API Gateway hard limit. A hung downstream rides all the way to 29 s (proven by the Jun 1 = 29.0 s timeout) instead of failing fast with a useful error.
6. **The alarm is structurally flap-prone.** `monitoring-stack.ts` :146–170: p99 Duration, `evaluationPeriods: 1`, period 5 min. On a ~40-invocation/5-min function, a single slow request dominates p99, so one tail event = one page, and it self-clears one period later (exactly the `OK→ALARM→OK` we saw, and the Jun 1/2/5 flaps in alarm history).

## Plan

### Phase 1 — Make the next spike diagnosable (do first; ~half day; low risk, additive)

- [x] **Enable X-Ray active tracing on the API Lambda.** DONE — `tracing: lambda.Tracing.ACTIVE` on the ApiFunction; `AWS_XRAY_CONTEXT_MISSING=LOG_ERROR` set defensively.
  - [x] Wrapped the Lambda-invoke clients in `mssql-executor-client.ts` + `tunnel-client.ts` with `captureAWSv3Client` (guarded on `AWS_LAMBDA_FUNCTION_NAME` so local dev/tests, which have no segment, don't trip the context-missing error).
  - [~] **Deviation:** did _not_ add a pg/Prisma X-Ray subsegment (awkward through the PrismaPg adapter). DB time is instead captured by the always-on structured `request.completed` log line below (`dbMs`/`dbCalls`), which is sampling-independent and feeds Logs-Insights directly — the same diagnostic, more robustly. Revisit a pg subsegment only if the log breakdown proves insufficient.
- [x] **Turn on API Gateway access logging.** DONE — dedicated `ApiAccessLogGroup` + `AccessLogSettings` on the `$default` stage via the `CfnStage` escape hatch. Format carries `requestId`, `routeKey`, `path`, `method`, `status`, `responseLatency`, `integrationLatency`, `integrationStatus`, `ip`, `requestTime`, `protocol`. HTTP-API write permission granted via a CloudWatch Logs resource policy (`grantWrite` to the `apigateway.amazonaws.com` principal).
- [x] **Add one structured per-request log line.** DONE — `middleware/request-timing.ts` (wired after `correlationMiddleware`) emits `request.completed` with `route` (matched pattern), `status`, `durationMs`, `downstreamMs`, `unattributedMs`, and per-downstream `{db,mssql,tunnel}` ms+call counts, keyed by the existing `correlationId`. Backed by an `AsyncLocalStorage` accumulator (`lib/request-timing.ts`) the downstream clients + the tenant Prisma extension record into. Pairs with the saved Insights queries in `audit-observability-alerting.md` Phase 2.

### Phase 2 — Stop slow requests from riding to the timeout (~2–3 h; behavior change, test in staging)

- [ ] **Set explicit client-side timeouts below the 29 s Lambda ceiling.** Give the Neon/pg client, the `MssqlExecutorFn` invoke, and the `TunnelProxyFn` invoke a hard timeout (suggest 5–8 s) so a hung dependency fails fast with a typed error (and a logged downstream name) instead of a 29 s wall. Files: `apps/api/src/lib/mssql-executor-client.ts`, `apps/api/src/lib/tunnel-client.ts`, and the DB client setup. **Validate in staging** — confirm normal slow-but-legitimate queries (reports, bulk reads) complete under the chosen budget before shipping, or they'll start failing.
- [ ] **Connection reuse review (Neon).** If the slow segment turns out to be Neon (Phase 1 will confirm), verify the handler reuses a pooled connection across warm invocations and uses Neon's pooler endpoint rather than opening a fresh connection per request. _(RDS Proxy is N/A here — backend is Neon serverless + Lambda-invoked tenant MSSQL, not RDS.)_

### Phase 3 — De-flap the alarm (~30 min; coordinate with observability audit)

- [x] **Reduce single-tail-event paging.** DONE — took the recommended option: `LambdaDurationP99Alarm` now `evaluationPeriods: 3`, `datapointsToAlarm: 2` (2-of-3 five-minute window), threshold unchanged at 10 000 ms, `treatMissingData: NOT_BREACHING`. A single 16 s request no longer pages; a sustained regression still does within ~15 min.
  - ~~Move to `evaluationPeriods: 3`, `datapointsToAlarm: 2` (M-of-N)~~ — chosen.
  - Or alarm on a **count of slow invocations** (metric-math: count of Duration samples > 10 s ≥ N per period), which is more intuitive than p99 on low traffic.
  - Keep `TreatMissingData.NOT_BREACHING`. Do **not** simply raise the threshold — 16 s requests are worth knowing about; the problem is _paging on one of them_, not the threshold value.
- [ ] Confirm this alarm's SNS topic actually has a subscriber (the email arrived today, so it does now — but `audit-observability-alerting.md` Finding 1 flagged zero subscribers; verify it's truly fixed and not a one-off manual sub).

### Phase 4 — Optional, only if cold starts become the complaint (not today's issue)

- [ ] Provisioned concurrency would remove the 2.6–4.4 s cold starts but does **not** address the 16.8 s warm-request root cause. Defer unless cold-start p99 (separate from this incident) becomes a product problem. Cost noted below.

## Costs

All figures us-east-1, sized to current traffic (~40 invocations / 5 min ≈ **~350 K invocations/month**).

| Change                                        | Mechanism                                                                             | Est. monthly cost                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| X-Ray active tracing                          | $5.00 / 1M traces recorded + $0.50 / 1M retrieved; ~350 K traces/mo                   | **~$2**                                                         |
| API Gateway access logs                       | CloudWatch Logs ingest $0.50/GB + storage $0.03/GB; ~350 K lines × ~1 KB ≈ 0.35 GB/mo | **<$1**                                                         |
| Per-request app log line                      | Marginal added ingest (~0.2 GB/mo) on the existing log group                          | **~$0.10**                                                      |
| Client timeouts                               | Code only                                                                             | **$0**                                                          |
| Alarm de-flap (M-of-N)                        | Same one standard alarm (already $0.10/mo)                                            | **$0 delta**                                                    |
| **Phase 1–3 total**                           |                                                                                       | **~$3–4 / month**                                               |
| _(Phase 4, optional)_ Provisioned concurrency | 1 unit @ 512 MB: 0.5 GB × $0.0000041667/GB-s × 2.59M s                                | **~$5.40 / unit / mo** (+ this is the costly one; skip for now) |

Net: the diagnostic + hardening work that actually fixes the incident costs **~$3–4/month**. The only meaningful cost (provisioned concurrency) is the one change we are **not** recommending for this issue.

## Files to Modify / Create

- `packages/infra/lib/stacks/api-stack.ts` — add `tracing: ACTIVE` (:239–328); add access-log LogGroup + `AccessLogSettings` on `$default` stage (:1286–1319).
- `packages/infra/lib/stacks/monitoring-stack.ts` — alarm `evaluationPeriods`/`datapointsToAlarm` or metric-math rewrite (:146–170).
- `apps/api/src/lambda.ts` (or router middleware) — structured per-request log line.
- `apps/api/src/lib/mssql-executor-client.ts`, `apps/api/src/lib/tunnel-client.ts`, DB client setup — X-Ray subsegments + client timeouts.
- `package.json` (api app) — add `aws-xray-sdk-core` dependency.

## Side Effects & Risks

- **Client timeouts (Phase 2) are the one behavioral risk:** too-tight a budget will start failing legitimately-slow queries. Measure real downstream timings from Phase 1 tracing **before** finalizing the timeout value; ship to staging first.
- X-Ray adds a small per-invocation overhead (a few ms) — negligible against a function alarmed at 10 s, but worth noting since the function is duration-sensitive.
- Access-log format changes are append-only and safe; the new LogGroup needs a `RemovalPolicy` consistent with the existing `ApiLogGroup` (DESTROY).
- Alarm M-of-N change widens detection latency by up to ~2 periods (~10 min) for a _sustained_ regression — acceptable trade for killing single-event flaps.

## Acceptance Criteria / Verification

- [ ] After deploy, an X-Ray trace for a sample API request shows distinct segments for Neon, MSSQL-executor invoke, and tunnel invoke.
- [ ] API Gateway access logs show `integrationLatency` and `routeKey`/`path` per request; a Logs Insights query can rank endpoints by p99 latency.
- [ ] The **next** >10 s event has either a trace or an access-log line identifying the slow downstream and the endpoint (i.e. it is no longer a black box).
- [ ] A simulated hung downstream fails at the client timeout (5–8 s) with a typed, logged error naming the downstream — not at 29 s.
- [ ] A single injected slow request no longer moves the alarm to ALARM (M-of-N), while two within the window still do.
