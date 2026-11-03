// ---------------------------------------------------------------------------
// findTenantsAtRunnerConcurrencyCap — integration tests against a live
// Postgres (skipped without DATABASE_URL). The groupBy's WHERE clause IS the
// logic (which rows count against the cap), so it runs against real SQL.
//
// Other suites share the database, so assertions only check this suite's own
// tenants are (or are not) in the result — never the result's exact contents.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest'
import { db } from '../../db'
import { findTenantsAtRunnerConcurrencyCap } from '../start-workflow-execution'

const hasDb = Boolean(process.env['DATABASE_URL'])

const SLUG = 'test-tenant-runner-concurrency-cap'
const NOW = new Date('2030-06-01T12:00:00.000Z')
let tenantId: string
let tenantWorkflowId: string
let curatedWorkflowId: string
let draftWorkflowId: string

async function executions(
  n: number,
  data: {
    status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED'
    workflowId?: string
    dryRun?: boolean
  },
) {
  for (let i = 0; i < n; i++) {
    await db.workflowExecution.create({
      data: {
        tenantId,
        workflowId: data.workflowId ?? tenantWorkflowId,
        status: data.status,
        input: {},
        queuedAt: NOW,
        dryRun: data.dryRun ?? false,
      },
    })
  }
}

describe.skipIf(!hasDb)('findTenantsAtRunnerConcurrencyCap (integration)', () => {
  beforeAll(async () => {
    const tenant = await db.tenant.upsert({
      where: { slug: SLUG },
      create: { name: 'Test Tenant (runner concurrency cap)', slug: SLUG },
      update: {},
    })
    tenantId = tenant.id
    await db.workflowExecution.deleteMany({ where: { tenantId } })
    await db.workflow.deleteMany({ where: { tenantId } })
    const base = {
      tenantId,
      version: '1.0.0',
      visibility: 'TENANT' as const,
      createdByUserId: 'user-1',
    }
    const workflow = async (name: string, executable: boolean) =>
      (
        await db.workflow.create({
          data: {
            ...base,
            name,
            executable,
            artifactKey: `workflows/${tenantId}/${name}/1.0.0.zip`,
            manifest: { name, version: '1.0.0' },
          },
        })
      ).id
    tenantWorkflowId = await workflow('tenant_custom_workflow', true)
    curatedWorkflowId = await workflow('send_quote_followup', true)
    draftWorkflowId = await workflow('tenant_draft_workflow', false)
  })

  beforeEach(async () => {
    await db.workflowExecution.deleteMany({ where: { tenantId } })
  })

  afterAll(async () => {
    await db.workflowExecution.deleteMany({ where: { tenantId } })
    await db.workflow.deleteMany({ where: { tenantId } })
    await db.tenant.deleteMany({ where: { id: tenantId } })
  })

  it('returns a tenant with exactly 5 QUEUED/RUNNING tenant-runner runs', async () => {
    await executions(3, { status: 'RUNNING' })
    await executions(2, { status: 'QUEUED' })

    expect(await findTenantsAtRunnerConcurrencyCap(db)).toContain(tenantId)
  })

  it('omits a tenant with 4 active runs', async () => {
    await executions(4, { status: 'RUNNING' })

    expect(await findTenantsAtRunnerConcurrencyCap(db)).not.toContain(tenantId)
  })

  it('does not count terminal, dry-run, curated (STDLIB) or non-executable runs', async () => {
    await executions(4, { status: 'RUNNING' })
    await executions(2, { status: 'COMPLETED' })
    await executions(1, { status: 'FAILED' })
    await executions(2, { status: 'RUNNING', dryRun: true })
    await executions(2, { status: 'RUNNING', workflowId: curatedWorkflowId })
    await executions(2, { status: 'RUNNING', workflowId: draftWorkflowId })

    expect(await findTenantsAtRunnerConcurrencyCap(db)).not.toContain(tenantId)
  })
})
