# Audit: Observability & Alerting — Remediation Plan

> **Status: COMPLETE & DEPLOYED** — Phases 0–2 shipped (Phase 0 in Wave 1;
> Phases 1–2 via #253, reconcile alarm via #251 Unit 11), live in prod. Remaining
> boxes are explicitly optional/deferred: Slack (Phase 0), Cognito-throttle alarm
> (Phase 1, justified skip), dashboard-link footer (Phase 2, optional), and Phase 3
> AI triage (deferred under the AI-automation hold). Ready to archive. — updated 2026-06-13

**Branch:** `worktree-agent-abb662dad2acdc8a7`
**Goal:** Make production incidents actually reach Steve (alarms currently fire into an unsubscribed SNS topic), close the highest-value alarm coverage gaps (throttles, ECS worker, workflows reconcile), and make alarm investigation fast (saved Insights queries; optional AI triage).

Scope note: this plan covers **runtime observability of the production system** — alarms, routing, dashboards, error aggregation, log querying. Deploy notifications, rollback detection, and CI-failure triage are owned by other audit units.

---

## Context

### Finding 1 (CRITICAL): the alarm SNS topic has zero subscribers

`packages/infra/lib/stacks/monitoring-stack.ts:59-61` creates SNS topic `pegasus-alarms`, and **every alarm in the system** routes to it via `addAlarmAction(snsAction)`. But there is **no `addSubscription` call and no `aws-cdk-lib/aws-sns-subscriptions` import anywhere in `packages/infra`** (verified by grep across `lib/`). Unless someone subscribed manually in the console (not in IaC, so it won't survive topic replacement and isn't reproducible across the staging/prod accounts), every alarm fires into the void. A solo dev gets **zero notification of prod incidents** — the entire alarm investment below is currently inert.

MonitoringStack is instantiated once per env (`packages/infra/bin/app.ts:288-296`) — dev, staging (acct `248812875460`), prod (acct `331145994639`) each have their own topic, so routing must be wired per env.

### Finding 2: alarm inventory is broader than expected — 11 alarms, all well-designed, all unrouted

`monitoring-stack.ts` defines (research notes said 3; actual count is up to 11):

| Alarm                                                                                    | Line       | Covers                                                               |
| ---------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------- |
| `pegasus-lambda-errors` (3 of 5 min)                                                     | :83        | **main API Lambda only**                                             |
| `pegasus-apigw-5xx` (>1/min)                                                             | :110       | HTTP API                                                             |
| `pegasus-lambda-duration-p99` (>10s)                                                     | :135       | main API Lambda only                                                 |
| `pegasus-avp-store-count-warn/critical` (60/80)                                          | :172, :185 | AVP quota; `BREACHING` on missing data catches a dead emitter        |
| 5× RingCentral health alarms (outbox dead/backlog, subs dead, conns unhealthy, sync lag) | :218-283   | RC capture pipeline gauges                                           |
| `pegasus-rc-capture-dlq` (depth >0)                                                      | :295       | RC capture SQS DLQ (the only DLQ in the system — `api-stack.ts:899`) |

Plus the `Pegasus-Operations` dashboard (:310). The design quality is good — the problem is routing (Finding 1) and coverage (Finding 3).

### Finding 3: alarm coverage gaps

1. **No Throttles alarm anywhere** (`grep -rn Throttle packages/infra/lib` → only test noise). Both Pegasus accounts are capped at **10 concurrent Lambda executions** (Service Quotas request L-B99A9384 pending), and this has already caused a real incident: AppGuard's parallel reference-data fetches → `TooManyRequestsException` → drivers 500 / zones-states 503. An account-wide `AWS/Lambda Throttles` alarm (no dimensions = all functions) would have caught it immediately. This is the single highest-value missing alarm.
2. **The Lambda Errors alarm covers one function.** `monitoring-stack.ts:66-74` dimensions on `props.lambdaFunctionName` = the main API Lambda (`bin/app.ts:293`). Uncovered: 8 scheduled Lambdas in `api-stack.ts` (reconcile poller every 1 min :494, AVP store count hourly :740, RC token-refresh :794, RC sync :839, RC renew :882, RC forward :994, RC buffer-purge :1040, RC metrics :1093), 3 Cognito triggers (`cognito-stack.ts:162,195,227`), the document converter (`documents-stack.ts:76`), and the WireGuard/tunnel Lambdas incl. `MssqlExecutorFn` (`wireguard-stack.ts:348,416,759,784` — the longhaul on-prem path). Partial mitigations exist (AVP alarm breaches on missing data; RC gauges would eventually show damage) but e.g. a crashing RC renew cron or mssql-executor only surfaces as downstream symptoms hours later. An **undimensioned** `AWS/Lambda Errors` alarm covers all of them — including functions added in the future — with one resource.
3. **Temporal worker (ECS Fargate) has no alarms at all.** `temporal-worker-stack.ts` enables Container Insights (:184) and a deploy-time circuit breaker (:358), but a **runtime** crash-loop (task exits after startup, ECS restarts it forever) is invisible — `desiredCount: 1` (:343), so a flapping worker means workflows silently stop executing. `ECS/ContainerInsights RunningTaskCount` exists (Container Insights is on) but nothing alarms on it. Temporal Cloud-side queue lag metrics are out of easy reach (separate metrics endpoint + scrape infra) — **not worth it now**; the reconcile-poller metric (next item) is the cheap proxy for "workers not finishing work".
4. **`Pegasus/Workflows` metric is emitted but never alarmed or dashboarded.** `WorkflowExecutionReconciled` (`packages/infra/lib/metrics.ts:61-69`, emitted by `apps/api/src/lambda-reconcile-workflow-executions.ts`) — its own doc comment says _"a sustained non-zero value means workers are crashing mid-execution"_, which is precisely an alarm condition. `monitoring-stack.ts` doesn't import the namespace.

### Finding 4: logging posture is good; one small defect

- **Retention**: consistently `ONE_MONTH` across all log groups (api-stack ×9, `documents-stack.ts:72`, `temporal-worker-stack.ts:230`). Fine for this stage; no change needed.
- **Structured logging**: `@aws-lambda-powertools/logger` via `apps/api/src/lib/logger.ts`, imported by ~70 files. Correlation middleware (`apps/api/src/middleware/correlation.ts`) appends `correlationId`/`method`/`path` to every log line and echoes the ID to clients. The temporal worker emits structured JSON too (`apps/temporal-worker/pegasus_temporal_worker/worker.py` `_JsonFormatter`). `console.*` stragglers exist only in 2 offline scripts (`apps/api/src/scripts/`), not in handlers. **No remediation needed** — research note's concern is unfounded.
- **Defect**: `correlation.ts:28-31` calls `logger.removeKeys` after `await next()` with no `try/finally`. When a handler throws (the exact case where logs matter most), the keys are never removed and **leak into the next warm invocation** — subsequent unrelated requests log the previous request's `correlationId`/`path`, which actively misleads debugging.

### Finding 5: no error-aggregation tooling, no saved log queries

No Sentry (grep: only a comment in `apps/mobile/src/utils/logger.ts`), no `logs.QueryDefinition` resources anywhere in CDK. Every alarm investigation today means hand-writing CloudWatch Insights queries from scratch in the console. Decision rationale in Phase 2.

---

## Plan

### Phase 0 — Route alarms to a human (quick win, ~1h) — DO THIS FIRST

- [x] **Add an email subscription to the alarm topic** (effort: ~30 min code + 2 confirm-clicks).
      In `monitoring-stack.ts`:

  ```ts
  import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions'

  // MonitoringStackProps:
  /** Email address subscribed to all alarms. Omit to skip (dev). */
  readonly alarmEmail?: string

  // after topic creation:
  if (props.alarmEmail) {
    alarmTopic.addSubscription(new subscriptions.EmailSubscription(props.alarmEmail))
  }
  ```

  In `bin/app.ts:288-296`, thread it per env (staging + prod only; dev stays silent):

  ```ts
  alarmEmail:
    (app.node.tryGetContext('alarmEmail') as string | undefined) ??
    (envName === 'staging' || envName === 'prod' ? 'dolasllc@gmail.com' : undefined),
  ```

  Operational note: SNS email subscriptions require a **one-time confirmation click** per address per topic — after deploy, two "AWS Notification - Subscription Confirmation" emails arrive (staging + prod); CloudFormation cannot confirm them for you. Until clicked, the subscription is `PendingConfirmation` and deliveries drop.

- [x] **Add OK-actions so recovery is also notified** (effort: ~15 min). For a solo dev, "it self-healed at 3am" is as valuable as the page. Add `alarm.addOkAction(snsAction)` everywhere `addAlarmAction` is called (6 call sites in `monitoring-stack.ts`: :96, :120, :146, :183, :196, :282, :306 — consider a small `wire(alarm)` helper to dedupe).
- [x] **Update `packages/infra/lib/stacks/__tests__/monitoring-stack.test.ts`**: assert one `AWS::SNS::Subscription` with `Protocol: 'email'` when `alarmEmail` is set, zero when absent; assert alarms carry both `AlarmActions` and `OKActions`.
- [ ] _(Optional, deferred)_ AWS Chatbot → Slack: only if a Slack workspace is actually in daily use. The CDK is ~10 lines (`aws-chatbot.SlackChannelConfiguration` + `notificationTopics: [alarmTopic]`) but requires a one-time console OAuth of the Slack workspace. Email is sufficient to close the gap; do not block on this.

### Phase 1 — Close the highest-value alarm gaps (~half day)

All in `monitoring-stack.ts` + props threaded from `bin/app.ts`; each alarm wired to the same topic via the Phase-0 helper.

- [x] **Account-wide Lambda Throttles alarm** (effort: ~30 min). Undimensioned `AWS/Lambda` metrics aggregate across ALL functions in the account/region — one alarm covers every current and future Lambda:

  ```ts
  const accountThrottles = new cloudwatch.Metric({
    namespace: 'AWS/Lambda',
    metricName: 'Throttles', // no dimensionsMap → account-wide
    statistic: 'Sum',
    period: cdk.Duration.minutes(1),
  })
  new cloudwatch.Alarm(this, 'AccountLambdaThrottlesAlarm', {
    alarmName: 'pegasus-lambda-throttles-account',
    alarmDescription:
      'Any Lambda in the account is being throttled — likely the 10-concurrent-execution ' +
      'account cap (Service Quotas L-B99A9384). Symptoms cascade as 5xx (AppGuard incident).',
    metric: accountThrottles,
    threshold: 0,
    evaluationPeriods: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  })
  ```

- [x] **Account-wide Lambda Errors alarm** (effort: ~30 min). Same undimensioned pattern, `metricName: 'Errors'`, 3-of-5×1-min datapoints (mirror :89-93) — covers the 13+ uncovered functions from Finding 3.2 (crons, Cognito triggers, document converter, mssql-executor) in one resource. Keep the existing per-API-fn alarm (it has a sharper description and the API fn is the highest-traffic one); name the new one `pegasus-lambda-errors-account` and note in its description that it includes scheduled/cron functions whose failures otherwise go unseen.
- [x] **Temporal worker RunningTaskCount alarm** (effort: ~1h). Names are deterministic (`pegasus-temporal-worker-${envName}`, `temporal-worker-stack.ts:183/342`), so pass plain strings — no cross-stack construct refs and no ordering problem (MonitoringStack at `bin/app.ts:288` is created before TemporalWorkerStack at :372, which is staging/prod-only):

  ```ts
  // MonitoringStackProps: readonly temporalWorkerClusterName?: string  (+ serviceName)
  // bin/app.ts: pass `pegasus-temporal-worker-${envName}` for both… actually:
  //   clusterName: `pegasus-temporal-worker-${envName}`, serviceName: same value
  //   (cluster :183, service :342 use the same name) — staging/prod only, else undefined.
  if (props.temporalWorkerClusterName && props.temporalWorkerServiceName) {
    const runningTasks = new cloudwatch.Metric({
      namespace: 'ECS/ContainerInsights',
      metricName: 'RunningTaskCount',
      dimensionsMap: {
        ClusterName: props.temporalWorkerClusterName,
        ServiceName: props.temporalWorkerServiceName,
      },
      statistic: 'Minimum',
      period: cdk.Duration.minutes(1),
    })
    new cloudwatch.Alarm(this, 'TemporalWorkerDownAlarm', {
      alarmName: 'pegasus-temporal-worker-down',
      alarmDescription:
        'Temporal worker RunningTaskCount < 1 for 5 consecutive minutes — the worker is ' +
        'crash-looping or stopped; workflow executions will sit RUNNING until reconciled.',
      metric: runningTasks,
      threshold: 1,
      evaluationPeriods: 5,
      datapointsToAlarm: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      // BREACHING: Container Insights emits no datapoint when zero tasks ran all period —
      // missing data IS the failure mode here.
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    })
  }
  ```

  5-of-5 minutes tolerates the brief task-count dip during rolling deploys (`minHealthyPercent: 0`, single task — a normal image roll replaces the task in well under 5 min). **Note:** dev has no worker stack → props undefined → no alarm (correct). Temporal Cloud queue-lag: explicitly deferred (requires scraping Temporal Cloud's metrics endpoint; the reconcile alarm below is the cheap proxy).

- [x] **Workflows reconcile alarm** (effort: ~30 min). Import `PEGASUS_WORKFLOWS_METRIC_NAMESPACE` / `WORKFLOW_EXECUTION_RECONCILED_METRIC_NAME` from `../metrics`; alarm on `Sum > 2` over 15 min (one-off orphan = noise; a stream of them = workers dying mid-execution), `NOT_BREACHING` (no data = nothing reconciled = healthy). Add a dashboard widget alongside.
- [x] **Dashboard row** for the new metrics (account Errors/Throttles graph, RunningTaskCount, WorkflowExecutionReconciled) appended to the `widgets` array at :312.
- [x] **Update `monitoring-stack.test.ts`** fine-grained assertions for each new alarm (existing test style: `template.hasResourceProperties('AWS::CloudWatch::Alarm', {...})`).
- [ ] _(Deferred, justified)_ Cognito throttle alarms: Cognito sign-in volume is tiny (tens of users); the account-wide Lambda Errors alarm already catches trigger-Lambda failures, which is the realistic Cognito failure mode here. Skip until user volume justifies it.

### Phase 2 — Error visibility: saved Insights queries + correlation fix (~2-3h)

**Decision: CloudWatch Logs Insights saved queries, not Sentry.** Reasoning: (a) the logs are already structured JSON with `correlationId` — exactly what Insights queries exploit; Sentry would duplicate that with an SDK that adds cold-start weight to a Lambda already alarmed on p99 duration; (b) the backend error path is already alarmed (5xx + Errors alarms) — what's missing is fast _investigation_, which saved queries solve at $0 with zero new accounts/DSNs/envs to manage; (c) Sentry's real differentiator is **frontend** error aggregation (sourcemapped browser stacks, session replay) — tenant-web/admin-web currently have no error reporting at all, but that is a product-maturity call to make when tenant-facing bugs become the pain point, not part of closing this gap. Revisit Sentry (free tier, browser SDK only, no Lambda SDK) if/when frontend blindness bites.

- [x] **Add `logs.QueryDefinition` resources to MonitoringStack** (effort: ~1.5h). Saved queries appear in the console's Insights query picker — investigation becomes "pick query, set time range" instead of writing PPL from memory. Thread the api log-group name in via props (or query across `/aws/lambda/*` name patterns). Four queries:

  ```ts
  new logs.QueryDefinition(this, 'QueryApiErrors', {
    queryDefinitionName: 'pegasus/api-errors-by-route',
    queryString: new logs.QueryString({
      fields: ['@timestamp', 'level', 'path', 'message', 'correlationId'],
      filterStatements: ['level = "ERROR"'],
      stats: 'count(*) as errors by path',
      sort: 'errors desc',
    }),
    logGroupNames: [props.apiLogGroupName], // pass from ApiStack via bin/app.ts
  })
  ```

  - `pegasus/api-errors-by-route` — above.
  - `pegasus/trace-by-correlation-id` — `fields @timestamp, level, message | filter correlationId = "PASTE_ID" | sort @timestamp asc` (the x-correlation-id from a user bug report → full request trace).
  - `pegasus/cron-failures` — `fields @timestamp, @log, @message | filter @message like /ERROR|Task timed out/` across the 8 cron log groups (pass names via props array).
  - `pegasus/temporal-worker-errors` — `fields @timestamp, level, message | filter level = "ERROR"` on `/pegasus/${envName}/temporal-worker` (staging/prod only — gate on the same optional props as the ECS alarm).

- [x] **Fix the correlation-key leak** (effort: 15 min, `apps/api/src/middleware/correlation.ts:28-31`):

  ```ts
  try {
    await next()
  } finally {
    logger.removeKeys(['correlationId', 'method', 'path'])
  }
  ```

  Add a unit case to `apps/api/src/middleware/correlation.test.ts`: handler throws → a subsequent request does not log the prior `correlationId`.

- [ ] **Add a dashboard link to the alarm description footer** (effort: 15 min, optional): append `Dashboard: https://console.aws.amazon.com/cloudwatch/home#dashboards/dashboard/Pegasus-Operations` to alarm descriptions so the email contains a one-click jump.

### Phase 3 — AI-assisted alarm triage (optional; only after Phases 0-2 are live)

**Honest assessment:** for a solo dev the value is real but conditional. An alarm email today says "pegasus-lambda-errors → ALARM" with zero context; diagnosis requires logging into the right account, finding the log group, writing a query. Phases 0-2 reduce that to ~3-5 minutes (email → saved query). An AI triage step reduces it to ~0 (the email _contains_ the probable cause + correlation IDs), and crucially works from a phone at 11pm. It is **not** worth it if alarm volume stays at ~1/month — build it the first time an alarm investigation actually feels slow, not preemptively. **"No AI needed" verdicts:** alarm coverage, retention, saved queries, routing (Phases 0-2) are pure CDK — AI adds nothing there.

- [ ] **Design (when triggered): SNS → triage Lambda → Anthropic API → email** (effort: ~1 day).
  - New `NodejsFunction` in MonitoringStack subscribed to `pegasus-alarms` (`alarmTopic.addSubscription(new subscriptions.LambdaSubscription(fn))`); the existing email subscription stays — the AI summary is a _second_, slower email, so a broken triage Lambda can never suppress the raw page.
  - Handler: parse the CloudWatch alarm JSON from the SNS envelope → map `AlarmName` → relevant log group(s) (a static lookup table mirroring the Finding-3 inventory) → `StartQuery`/`GetQueryResults` (CloudWatch Logs Insights SDK) over the trailing 30 min filtered to `level = "ERROR"`, cap ~200 lines → one Anthropic Messages API call → send summary via SES (`no-reply@pegasus[-qa].dolas.dev` is already a verified SES identity from the invite-email rollout — reuse it).
  - **Concrete API approach:** official TypeScript SDK `@anthropic-ai/sdk`, `client.messages.create({ model, max_tokens: 2048, messages: [...] })`. Default model `claude-opus-4-8` ($5/$25 per MTok); `claude-haiku-4-5` ($1/$5 per MTok) is the cost floor and adequate for log summarization. Either way cost is **cents per month** at expected alarm volume (~50K input tokens per triage ≈ $0.25 on Opus, $0.05 on Haiku) — model choice is not a cost decision here, so default to Opus for the better diagnosis. Prompt shape: system = "You are triaging a CloudWatch alarm for a serverless move-management SaaS; given the alarm JSON and recent error logs, state the most likely root cause, the affected component, and the 2-3 correlationIds to investigate; be terse." `ANTHROPIC_API_KEY` in Secrets Manager, injected via `Secret.fromSecretCompleteArn` (per the established gotcha — full ARN with suffix, threaded through a per-env map in `bin/app.ts` like `TEMPORAL_SECRET_ARNS`).
  - **Why not the claude-code GitHub Action:** it is CI-bound (triggers on GitHub events, runs in Actions runners with repo context). Runtime alarms need an always-on, AWS-credentialed trigger — a Lambda subscribed to the topic is the right shape; the Action is the right tool for Unit 12's CI-failure triage, not this.
  - Guardrails: 2-min Lambda timeout; on any failure log and exit 0 (never retry-storm the Anthropic API from an alarm loop); skip triage for OK-state notifications.

---

## Files to Modify / Create

| File                                                           | Phase   | Change                                                                                                    |
| -------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `packages/infra/lib/stacks/monitoring-stack.ts`                | 0,1,2,3 | email/OK-action wiring; 4 new alarms; dashboard row; QueryDefinitions; (P3) triage Lambda                 |
| `packages/infra/bin/app.ts`                                    | 0,1,2   | thread `alarmEmail`, worker cluster/service names, log-group names into MonitoringStackProps              |
| `packages/infra/lib/stacks/api-stack.ts`                       | 2       | export api + cron log-group names as public readonly props (pattern: `ringcentralCaptureDlqName` at :172) |
| `packages/infra/lib/stacks/__tests__/monitoring-stack.test.ts` | 0,1,2   | assertions for subscription, OK-actions, new alarms, query definitions                                    |
| `apps/api/src/middleware/correlation.ts`                       | 2       | `try/finally` around `next()`                                                                             |
| `apps/api/src/middleware/correlation.test.ts`                  | 2       | leak-on-throw regression test                                                                             |
| (P3 only) `apps/api/src/lambda-alarm-triage.ts`                | 3       | new triage handler                                                                                        |

No other files. No new packages except (P3) `@anthropic-ai/sdk` in `apps/api`.

## Side Effects & Risks

- **Pending-confirmation trap**: until the SNS confirmation email is clicked (once per env), deliveries silently drop. The verification step below forces the check.
- **Merging to `main` auto-deploys** (deploy.yml). MonitoringStack changes are additive (new alarms/subscriptions; no resource replacement), so blast radius is low — but batch with other merges carefully (known cancelled-Deploy-run gotcha).
- **Alarm noise during deploys**: the ECS alarm's 5-of-5 window absorbs normal image rolls; if a future deploy legitimately takes >5 min at 0 tasks it will page — acceptable (a slow deploy of the only worker _is_ notification-worthy).
- **Account-wide Errors alarm includes everything** — a flaky one-off in any Lambda (e.g. an e2e-induced error on staging) pages. Staging and prod have separate topics/emails with env-distinguishable alarm ARNs; if staging noise gets annoying, drop `alarmEmail` for staging (one-line change) rather than tuning thresholds.
- **No alarm-storm dedupe on SNS email**: a regional event could fire 10+ alarms at once. Tolerable at this scale; revisit only if it happens.
- **OK-actions double email volume** per incident (ALARM + OK). Intended.
- **Phase 3 sends log excerpts to the Anthropic API** — logs may contain tenant data fragments. Keep the Insights query projection narrow (`level, message, correlationId`, no request bodies) and note this in the handler comment.

## Acceptance Criteria / Verification

All commands run with the Node-24 PATH pin (`/home/steve/.nvm/versions/node/v24.16.0/bin`) per the toolchain gotcha.

1. **Synth + tests pass**: from `packages/infra`: `npm test` and `npm run synth -- -c env=staging` — synth output contains `AWS::SNS::Subscription` (email), the 4 new `AWS::CloudWatch::Alarm` resources, and `AWS::Logs::QueryDefinition` resources. `npm run synth -- -c env=dev` contains **no** email subscription and no temporal-worker alarm.
2. **Subscription confirmed** (post-deploy, per env): `aws sns list-subscriptions-by-topic --topic-arn <pegasus-alarms arn>` shows `"SubscriptionArn"` as a real ARN, **not** `"PendingConfirmation"`.
3. **End-to-end alarm path** (post-deploy, staging): `aws cloudwatch set-alarm-state --alarm-name pegasus-lambda-throttles-account --state-value ALARM --state-reason "routing test"` → email arrives within ~1 min; alarm auto-returns to OK on the next datapoint → OK email arrives. (If Phase 3 is built: triage email also arrives with a summary.)
4. **Saved queries visible**: `aws logs describe-query-definitions --query-definition-name-prefix pegasus/` returns the 4 definitions; running `pegasus/trace-by-correlation-id` in the console against a recent request's `x-correlation-id` returns that request's log lines.
5. **Correlation leak fixed**: `npm test` in `apps/api` passes including the new throw-then-next-request case.
6. **Worker alarm sanity** (staging, optional): `aws ecs update-service --cluster pegasus-temporal-worker-staging --service pegasus-temporal-worker-staging --desired-count 0`, wait 6 min → `pegasus-temporal-worker-down` fires + email; restore `--desired-count 1` → OK email.
