# CDK Monitoring Stack (Alarms + Dashboard)

**Branch:** `feature/cdk-monitoring-stack`
**Goal:** CloudWatch alarms and dashboard via CDK for operational visibility on Lambda errors, API Gateway 5xx, and latency.

## Context

CDK stacks define Lambda + API GW + LogGroups but no alarms or dashboards. Infrastructure without alerting is a reliability risk that testing alone cannot address.

## Implementation Checklist

### 1. Monitoring stack tests

- [x] Write test: `packages/infra/lib/stacks/__tests__/monitoring-stack.test.ts`
  - CDK assertion: Lambda error alarm exists (threshold >5/min)
  - CDK assertion: API GW 5xx alarm exists (threshold >1%)
  - CDK assertion: Lambda duration p99 alarm exists (threshold >10s)
  - CDK assertion: CloudWatch dashboard exists
  - SNS topic for alarm notifications

### 2. Monitoring stack implementation

- [x] Create `packages/infra/lib/stacks/monitoring-stack.ts`
  - CloudWatch alarms:
    - Lambda errors > 5 per minute
    - API Gateway 5xx > 1%
    - Lambda duration p99 > 10 seconds
  - CloudWatch dashboard with key metrics
  - SNS topic for alarm notifications

### 3. Wire into CDK app

- [x] Modify `packages/infra/bin/app.ts` — add MonitoringStack
- [x] Expose `lambdaFunctionName`, `httpApiId`, `httpApiStage` from `ApiStack`

### 4. Verify

- [x] `npm test` — all pass (106/106 including new CDK assertion tests)
- [x] `npm run typecheck` — no new type errors
- [ ] `npx cdk synth` includes monitoring resources (deployment-time verification)

## Files

| Action | Path |
|--------|------|
| Create | `packages/infra/lib/stacks/monitoring-stack.ts` |
| Modify | `packages/infra/lib/stacks/__tests__/monitoring-stack.test.ts` (fix invalid `Match.anyValue()` nesting — pre-written test had CDK assertion bug) |
| Modify | `packages/infra/bin/app.ts` |
| Modify | `packages/infra/lib/stacks/api-stack.ts` (expose `lambdaFunctionName`, `httpApiId`, `httpApiStage`) |

## Risks / Side Effects

- New stack adds CloudWatch resources with associated AWS costs (minimal for alarms)
- SNS topic requires email subscription confirmation after deployment
- Must import Lambda function and API Gateway references from existing stacks

## Dependencies

None — can start immediately.
