# Provisioner reuses one async_operation_id for every key delete in a run

- **Branch:** `fix/temporal-provisioner-op-id-reuse`.
- **Found by:** Step 9 staging acceptance (2026-10-13), deprovisioning the test
  tenant `4b2e0267-c597-451e-a367-771dfac52fba` after #844.
- **Status:** same class of fix the user approved for #844 (a bug Step 9
  surfaced, fixed in its own workstream).

## The bug

`opId(tenantId, what)` is `${tenantId}-${what}-${nonce}` with ONE nonce per
run, so every `deleteKeyIfExists` in a run sends the same
`async_operation_id` (`<tenant>-delete-key-<nonce>`). Temporal treats it as
an idempotency key: the second delete gets **409** "async_operation_id … was
already used by a different operation". Hit live: deprovision deleted the
current key, then failed on the previous key.

Every run that deletes two keys for one tenant is affected:

- deprovision (current, previous, pending);
- rotate (discard a stale pending key, then retire the previous key);
- daily-maintenance (discard-pending for a tenant, then rotating it).

`FakeCloud` never enforced op-id uniqueness, so no test could catch it.

## Fix

1. Give each operation in a run its own id: a per-run counter in `opId`
   (`${tenantId}-${what}-${nonce}-${n}`), so ids stay unique within a run
   and across runs (the nonce).
2. `FakeCloud` rejects a reused `asyncOperationId` with a
   `CloudOpsConflictError` (409), like real Cloud.
3. Regression tests: deprovision with current + previous + pending; rotate
   that discards a pending key and retires a previous key in one run.
4. GOTCHAS: the op id must be unique per OPERATION, not per step.

## Progress (2026-10-13)

- [x] 1–4: `opId` = `${tenantId}-${what}-${nonce}-${++opSeq}`; `FakeCloud`
      rejects a reused id with a 409 (which alone failed the existing provision →
      rotate → deprovision test: the live bug, reproduced); a new test has one
      rotate discard a pending key and retire a previous key. GOTCHAS updated,
      and Step 9 run 2 recorded in the parent plan. apps/api: 4,105 tests pass.
- [ ] After deploy: Deprovision again (tracked by the parent's Step 9).

## After deploy

Click **Deprovision** again on the FAILED test tenant; confirm the previous
key is deleted, the namespace is gone, the row is removed. That completes
Step 9.
