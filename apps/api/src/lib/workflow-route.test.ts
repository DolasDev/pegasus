// ---------------------------------------------------------------------------
// Unit tests for workflow routing (Phase 3 Unit 10).
//
// These tests pin the routing decision table and the queue-name derivation
// contract. The queue name is a cross-language contract (TypeScript API →
// Python runner) — any change here must also be reflected in
// apps/tenant-runner/pegasus_tenant_runner/config.py (RunnerConfig.task_queue).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveWorkflowRoute, tenantTaskQueue, tenantTaskQueueEnv } from './workflow-route'

afterEach(() => {
  vi.unstubAllEnvs()
})

// ---------------------------------------------------------------------------
// resolveWorkflowRoute — routing decision table
// ---------------------------------------------------------------------------

describe('resolveWorkflowRoute', () => {
  // ── STDLIB lane ─────────────────────────────────────────────────────────

  it('routes a curated-name GLOBAL workflow to STDLIB (even when executable=false)', () => {
    // The curated stdlib row's executable flag is irrelevant — the name wins.
    expect(resolveWorkflowRoute({ name: 'send_quote_followup', executable: false })).toBe('STDLIB')
  })

  it('routes a curated-name TENANT fork to STDLIB (forked-curated shadowing contract)', () => {
    // A tenant forked send_quote_followup into their store. The row has the
    // same name — it still routes STDLIB (the stdlib worker's baked-in code
    // runs, not the tenant's fork bytes). This is the documented v1 curated-
    // shadowing behaviour; see workflow-route.ts module header.
    expect(resolveWorkflowRoute({ name: 'send_quote_followup', executable: true })).toBe('STDLIB')
  })

  // ── TENANT_RUNNER lane ───────────────────────────────────────────────────

  it('routes a non-curated executable workflow to TENANT_RUNNER', () => {
    expect(resolveWorkflowRoute({ name: 'my_custom_wf', executable: true })).toBe('TENANT_RUNNER')
  })

  it('routes another non-curated executable name to TENANT_RUNNER', () => {
    expect(resolveWorkflowRoute({ name: 'tenant_billing_alert', executable: true })).toBe(
      'TENANT_RUNNER',
    )
  })

  // ── NOT_EXECUTABLE lane ──────────────────────────────────────────────────

  it('routes a non-curated non-executable workflow to NOT_EXECUTABLE', () => {
    // Pre-Unit-6 row (no artifact validation performed yet) or a row that
    // failed validation — executable=false, not in curated set.
    expect(resolveWorkflowRoute({ name: 'my_custom_wf', executable: false })).toBe('NOT_EXECUTABLE')
  })

  it('routes a non-curated non-executable workflow to NOT_EXECUTABLE (upload in progress)', () => {
    expect(resolveWorkflowRoute({ name: 'wip_workflow', executable: false })).toBe('NOT_EXECUTABLE')
  })
})

// ---------------------------------------------------------------------------
// tenantTaskQueue — cross-language contract
// ---------------------------------------------------------------------------

describe('tenantTaskQueue', () => {
  it('produces the correct queue name in dev (env suffix unset)', () => {
    vi.stubEnv('TEMPORAL_TASK_QUEUE_ENV_SUFFIX', '')
    const tenantId = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'
    expect(tenantTaskQueue(tenantId)).toBe(`pegasus-tenant-${tenantId}-dev`)
  })

  it('produces the correct queue name for staging', () => {
    vi.stubEnv('TEMPORAL_TASK_QUEUE_ENV_SUFFIX', 'staging')
    const tenantId = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'
    expect(tenantTaskQueue(tenantId)).toBe(`pegasus-tenant-${tenantId}-staging`)
  })

  it('produces the correct queue name for prod', () => {
    vi.stubEnv('TEMPORAL_TASK_QUEUE_ENV_SUFFIX', 'prod')
    const tenantId = 'aaaabbbb-cccc-4ddd-8eee-ffffffffffff'
    expect(tenantTaskQueue(tenantId)).toBe(`pegasus-tenant-${tenantId}-prod`)
  })

  it('falls back to dev for an unset env suffix', () => {
    vi.stubEnv('TEMPORAL_TASK_QUEUE_ENV_SUFFIX', undefined)
    expect(tenantTaskQueueEnv()).toBe('dev')
  })

  it('falls back to dev for a whitespace-only env suffix', () => {
    vi.stubEnv('TEMPORAL_TASK_QUEUE_ENV_SUFFIX', '  ')
    expect(tenantTaskQueueEnv()).toBe('dev')
  })
})
