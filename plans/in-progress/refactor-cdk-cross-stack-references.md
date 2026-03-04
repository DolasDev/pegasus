# Plan: Refactor CDK Infra to Use Proper Cross-Stack References

**Branch:** main
**Goal:** Eliminate CDK context variables and the two-pass deploy by splitting frontend stacks to break the circular dependency, letting CDK wire values directly via `Fn.importValue`.

## Status

- [x] 1. Strip `frontend-stack.ts` to infra only (remove BucketDeployment, expose `siteBucket`)
- [x] 2. Strip `admin-frontend-stack.ts` to infra only (remove BucketDeployment, expose `adminBucket`)
- [x] 3. Update `cognito-stack.ts` — replace URL-array props with domain-name props; remove `adminCallbackUrls` CfnOutput
- [x] 4. Create `frontend-assets-stack.ts`
- [x] 5. Create `admin-frontend-assets-stack.ts`
- [x] 6. Rewrite `bin/app.ts` — direct cross-stack wiring, no context vars
- [x] 7. Rewrite `deploy.sh` — single `cdk deploy --all`
- [x] 8. Update tests (frontend-stack, admin-frontend-stack, cognito-stack)
- [x] 9. Create tests (frontend-assets-stack, admin-frontend-assets-stack)
- [x] 10. Run full test suite — 91 infra tests pass; domain passes; api skipped (no Docker)

## Files Modified

| File                                                                      | Action    |
| ------------------------------------------------------------------------- | --------- |
| `packages/infra/lib/stacks/frontend-stack.ts`                             | Modified  |
| `packages/infra/lib/stacks/admin-frontend-stack.ts`                       | Modified  |
| `packages/infra/lib/stacks/cognito-stack.ts`                              | Modified  |
| `packages/infra/lib/stacks/frontend-assets-stack.ts`                      | Created   |
| `packages/infra/lib/stacks/admin-frontend-assets-stack.ts`                | Created   |
| `packages/infra/bin/app.ts`                                               | Rewritten |
| `packages/infra/deploy.sh`                                                | Rewritten |
| `packages/infra/lib/stacks/__tests__/frontend-stack.test.ts`              | Modified  |
| `packages/infra/lib/stacks/__tests__/admin-frontend-stack.test.ts`        | Modified  |
| `packages/infra/lib/stacks/__tests__/cognito-stack.test.ts`               | Modified  |
| `packages/infra/lib/stacks/__tests__/frontend-assets-stack.test.ts`       | Created   |
| `packages/infra/lib/stacks/__tests__/admin-frontend-assets-stack.test.ts` | Created   |
