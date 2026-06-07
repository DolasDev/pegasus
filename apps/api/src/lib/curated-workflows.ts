// ---------------------------------------------------------------------------
// Curated workflow names — Phase 2 executable allowlist.
//
// The Phase 2 scope-lock: only curated stdlib workflows are runnable
// server-side. Arbitrary tenant-uploaded code is Phase 3 (with a sandbox).
// `POST /workflows/:id/run` validates the workflow's `name` against this
// list and rejects unknown names with 400 WORKFLOW_NOT_EXECUTABLE — both
// for direct GLOBAL stdlib rows AND for TENANT forks of those rows.
//
// This list is half of a two-sided contract:
//   • The other half lives in
//     `apps/temporal-worker/pegasus_temporal_worker/registry.py`'s
//     `_CURATED_WORKFLOWS` dict. The worker refuses to register anything
//     not in that dict, so even if the API allows a name through here,
//     the worker will Activity-fail an unknown workflow.
//   • The two are intentionally NOT auto-derived from a shared schema —
//     the worker is Python, this side is TypeScript, and the cost of a
//     drift-detection mechanism outweighs the one-line list maintenance.
//     When you add a curated workflow, add its name BOTH here and in the
//     Python registry, AND publish it under the platform tenant via
//     `packages/workflows-stdlib/`.
// ---------------------------------------------------------------------------

/**
 * Workflow `name` values the runtime worker has agreed to execute. Frozen
 * to discourage runtime mutation — any change is a deploy with both halves
 * of the contract updated.
 */
export const CURATED_WORKFLOW_NAMES: ReadonlySet<string> = new Set([
  'send_quote_followup',
])
