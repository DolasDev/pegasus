// ---------------------------------------------------------------------------
// Unit tests for the internal worker handler.
//
// Covers:
//   - Header-secret enforcement (missing / wrong / right) on BOTH endpoints.
//   - Per-tenant `wbk_` token auth (Phase 3 Unit 7): full matrix — own-tenant
//     success, cross-tenant 404 (indistinguishable from missing) on BOTH
//     endpoints, malformed / wrong-prefix / unknown-tenant / rotated-hash
//     401s, and shared-secret precedence when both headers are present.
//   - POST /workflow-runtime-token: happy path, missing execution, terminal-
//     execution refusal, no token in logs, Cache-Control: no-store.
//   - PATCH /workflow-executions/:id: state-machine validation, idempotent
//     terminal-self transition, RUNNING write, terminal write.
//   - GET /tenant-workflows (Phase 3 Unit 8): tenant-confined artifact
//     listing — own-tenant scope is forced for wbk_ tokens, mismatched
//     tenantId params 400, shared secret requires an explicit tenantId,
//     non-executable / digest-less rows are excluded by the where clause,
//     presigned URL + sha fields present, Cache-Control: no-store.
//
// Strategy: mock the `db` module (so no real Prisma is needed) and the
// runtime-token-crypto + tenant-scoped Prisma helpers. The validator and
// broker auth middleware are exercised via real HTTP-shaped requests; the
// token path runs the REAL parse + SHA-256 + timingSafeEqual verification in
// lib/tenant-broker-credential.ts against a mocked credential row.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockExecutionFindUnique,
  mockWorkflowFindUnique,
  mockWorkflowFindMany,
  mockCredentialFindUnique,
  mockExecRepo,
  mockDecryptRuntimeToken,
  mockPresignDownload,
} = vi.hoisted(() => ({
  mockExecutionFindUnique: vi.fn(),
  mockWorkflowFindUnique: vi.fn(),
  mockWorkflowFindMany: vi.fn(),
  mockCredentialFindUnique: vi.fn(),
  mockExecRepo: {
    findById: vi.fn(),
    markStarted: vi.fn(),
    markTerminal: vi.fn(),
  },
  mockDecryptRuntimeToken: vi.fn(),
  mockPresignDownload: vi.fn(),
}))

vi.mock('../db', () => ({
  db: {
    workflowExecution: { findUnique: mockExecutionFindUnique },
    workflow: { findUnique: mockWorkflowFindUnique, findMany: mockWorkflowFindMany },
    tenantBrokerCredential: { findUnique: mockCredentialFindUnique },
  } as unknown as PrismaClient,
}))

vi.mock('../lib/runtime-token-crypto', () => ({
  decryptRuntimeToken: mockDecryptRuntimeToken,
}))

vi.mock('../lib/documents-s3', () => ({
  presignDownload: mockPresignDownload,
}))

vi.mock('../lib/prisma', () => ({
  // Returns a no-op tenant-scoped Prisma client — the repo mock below
  // replaces its methods at the call site.
  createTenantDb: vi.fn(() => ({}) as unknown as PrismaClient),
}))

vi.mock('../repositories/workflow-execution.repository', () => ({
  createWorkflowExecutionRepository: vi.fn(() => mockExecRepo),
}))

import { workflowInternalHandler } from './workflow-internal'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BROKER_SECRET = 'a'.repeat(64)

// Per-tenant token fixtures (Phase 3 Unit 7). The handler's token path runs
// the real parse + hash + timing-safe compare, so these are valid-shape
// tokens whose SHA-256 hashes the mocked credential lookup returns.
const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'
const TENANT_A_TOKEN = `wbk_${TENANT_A}_${'ab'.repeat(24)}`
const TENANT_B_TOKEN = `wbk_${TENANT_B}_${'cd'.repeat(24)}`

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/**
 * Wires the mocked tenant_broker_credentials lookup: known tenants resolve to
 * their stored (correct) token hash, everything else to null.
 */
function stubCredentials(): void {
  mockCredentialFindUnique.mockImplementation(({ where }: { where: { tenantId: string } }) => {
    if (where.tenantId === TENANT_A) {
      return Promise.resolve({ tokenHash: sha256(TENANT_A_TOKEN) })
    }
    if (where.tenantId === TENANT_B) {
      return Promise.resolve({ tokenHash: sha256(TENANT_B_TOKEN) })
    }
    return Promise.resolve(null)
  })
}

function buildApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.route('/', workflowInternalHandler)
  return app
}

function withSecret(secret: string | null, body: unknown, method: 'POST' | 'PATCH' = 'POST') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (secret !== null) headers['X-Workflow-Broker-Secret'] = secret
  return {
    method,
    headers,
    body: JSON.stringify(body),
  }
}

function withToken(token: string, body: unknown, method: 'POST' | 'PATCH' = 'POST') {
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Workflow-Broker-Token': token,
    },
    body: JSON.stringify(body),
  }
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const VALID_EXECUTION_ID = '00000000-0000-4000-8000-000000000001'

describe('workflow-internal handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['WORKFLOW_BROKER_SECRET'] = BROKER_SECRET
  })

  // ── Shared-secret enforcement ──────────────────────────────────────────────

  describe('X-Workflow-Broker-Secret enforcement', () => {
    it('returns 401 with no header on the broker endpoint', async () => {
      const res = await buildApp().request(
        '/workflow-runtime-token',
        withSecret(null, { executionId: VALID_EXECUTION_ID }),
      )
      expect(res.status).toBe(401)
      expect((await json(res))['code']).toBe('INVALID_BROKER_SECRET')
    })

    it('returns 401 with the wrong header on the broker endpoint', async () => {
      const res = await buildApp().request(
        '/workflow-runtime-token',
        withSecret('not-the-secret', { executionId: VALID_EXECUTION_ID }),
      )
      expect(res.status).toBe(401)
    })

    it('returns 401 with the right header but no env var configured', async () => {
      delete process.env['WORKFLOW_BROKER_SECRET']
      const res = await buildApp().request(
        '/workflow-runtime-token',
        withSecret(BROKER_SECRET, { executionId: VALID_EXECUTION_ID }),
      )
      expect(res.status).toBe(401)
    })

    it('passes the gate on the PATCH endpoint with the right header', async () => {
      mockExecutionFindUnique.mockResolvedValue(null)
      const res = await buildApp().request(
        `/workflow-executions/${VALID_EXECUTION_ID}`,
        withSecret(BROKER_SECRET, { status: 'RUNNING' }, 'PATCH'),
      )
      // 404 here means we got past the gate — the row doesn't exist.
      expect(res.status).toBe(404)
    })
  })

  // ── Per-tenant broker tokens (Phase 3 Unit 7) ──────────────────────────────

  describe('X-Workflow-Broker-Token auth', () => {
    const executionOwnedBy = (tenantId: string, status = 'QUEUED') => ({
      id: VALID_EXECUTION_ID,
      tenantId,
      workflowId: 'wf-1',
      status,
      finishedAt: null,
    })

    beforeEach(() => {
      stubCredentials()
    })

    // ---- own tenant: both endpoints succeed -------------------------------

    it("mints a runtime token for the holder tenant's own execution", async () => {
      mockExecutionFindUnique.mockResolvedValue(executionOwnedBy(TENANT_A))
      mockWorkflowFindUnique.mockResolvedValue({ runtimeTokenCiphertext: 'CT' })
      mockDecryptRuntimeToken.mockResolvedValue('vnd_TENANT_A_RUNTIME')
      const res = await buildApp().request(
        '/workflow-runtime-token',
        withToken(TENANT_A_TOKEN, { executionId: VALID_EXECUTION_ID }),
      )
      expect(res.status).toBe(200)
      expect((await json(res))['token']).toBe('vnd_TENANT_A_RUNTIME')
    })

    it("PATCHes the holder tenant's own execution", async () => {
      mockExecutionFindUnique.mockResolvedValue(executionOwnedBy(TENANT_A, 'RUNNING'))
      mockExecRepo.markTerminal.mockResolvedValue({
        ...executionOwnedBy(TENANT_A, 'COMPLETED'),
        finishedAt: new Date('2026-06-11T10:05:00Z'),
      })
      const res = await buildApp().request(
        `/workflow-executions/${VALID_EXECUTION_ID}`,
        withToken(TENANT_A_TOKEN, { status: 'COMPLETED', result: { ok: true } }, 'PATCH'),
      )
      expect(res.status).toBe(200)
      expect(mockExecRepo.markTerminal).toHaveBeenCalledWith(
        VALID_EXECUTION_ID,
        expect.objectContaining({ status: 'COMPLETED' }),
      )
    })

    // ---- cross tenant: BOTH endpoints answer like the row doesn't exist ----

    it("refuses to mint a runtime token for ANOTHER tenant's execution", async () => {
      mockExecutionFindUnique.mockResolvedValue(executionOwnedBy(TENANT_B))
      mockWorkflowFindUnique.mockResolvedValue({ runtimeTokenCiphertext: 'CT' })
      mockDecryptRuntimeToken.mockResolvedValue('vnd_TENANT_B_RUNTIME')
      const res = await buildApp().request(
        '/workflow-runtime-token',
        withToken(TENANT_A_TOKEN, { executionId: VALID_EXECUTION_ID }),
      )
      expect(res.status).toBe(404)
      // No decrypt may even be attempted for a cross-tenant request.
      expect(mockDecryptRuntimeToken).not.toHaveBeenCalled()
    })

    it("refuses to PATCH ANOTHER tenant's execution", async () => {
      mockExecutionFindUnique.mockResolvedValue(executionOwnedBy(TENANT_B, 'RUNNING'))
      const res = await buildApp().request(
        `/workflow-executions/${VALID_EXECUTION_ID}`,
        withToken(TENANT_A_TOKEN, { status: 'FAILED', errorMessage: 'forged' }, 'PATCH'),
      )
      expect(res.status).toBe(404)
      expect(mockExecRepo.markTerminal).not.toHaveBeenCalled()
      expect(mockExecRepo.markStarted).not.toHaveBeenCalled()
    })

    it('cross-tenant denial body is byte-identical to a missing execution', async () => {
      mockExecutionFindUnique.mockResolvedValueOnce(executionOwnedBy(TENANT_B))
      const crossTenant = await buildApp().request(
        '/workflow-runtime-token',
        withToken(TENANT_A_TOKEN, { executionId: VALID_EXECUTION_ID }),
      )
      mockExecutionFindUnique.mockResolvedValueOnce(null)
      const missing = await buildApp().request(
        '/workflow-runtime-token',
        withToken(TENANT_A_TOKEN, { executionId: VALID_EXECUTION_ID }),
      )
      expect(crossTenant.status).toBe(404)
      expect(missing.status).toBe(404)
      expect(await crossTenant.text()).toBe(await missing.text())
    })

    it('cross-tenant PATCH cannot learn row state via INVALID_TRANSITION', async () => {
      // Terminal row owned by tenant B + an invalid transition: a same-tenant
      // caller would get 400 INVALID_TRANSITION; cross-tenant must get the
      // anonymous 404 instead.
      mockExecutionFindUnique.mockResolvedValue(executionOwnedBy(TENANT_B, 'COMPLETED'))
      const res = await buildApp().request(
        `/workflow-executions/${VALID_EXECUTION_ID}`,
        withToken(TENANT_A_TOKEN, { status: 'FAILED' }, 'PATCH'),
      )
      expect(res.status).toBe(404)
      expect((await json(res))['code']).toBe('NOT_FOUND')
    })

    // ---- invalid tokens: 401 on both endpoints -----------------------------

    const INVALID_TOKENS: Array<[label: string, token: string]> = [
      ['empty', ''],
      ['garbage', 'definitely-not-a-token'],
      ['wrong prefix (vnd_)', `vnd_${'ab'.repeat(24)}`],
      ['shared-secret-shaped', BROKER_SECRET],
      ['missing secret part', `wbk_${TENANT_A}`],
      ['non-hex secret part', `wbk_${TENANT_A}_${'zz'.repeat(24)}`],
      [
        'valid shape, unknown tenant',
        `wbk_33333333-3333-4333-8333-333333333333_${'ab'.repeat(24)}`,
      ],
      // The rotated-credential case: right shape + known tenant, but the
      // stored hash no longer matches (stubCredentials stores TENANT_A_TOKEN's
      // hash, this token has a different secret).
      ['stale secret after rotation', `wbk_${TENANT_A}_${'ef'.repeat(24)}`],
    ]

    for (const [label, token] of INVALID_TOKENS) {
      it(`401s a(n) ${label} token on the mint endpoint`, async () => {
        mockExecutionFindUnique.mockResolvedValue(executionOwnedBy(TENANT_A))
        const res = await buildApp().request(
          '/workflow-runtime-token',
          withToken(token, { executionId: VALID_EXECUTION_ID }),
        )
        expect(res.status).toBe(401)
        expect((await json(res))['code']).toBe('INVALID_BROKER_TOKEN')
        expect(mockExecutionFindUnique).not.toHaveBeenCalled()
      })

      it(`401s a(n) ${label} token on the PATCH endpoint`, async () => {
        mockExecutionFindUnique.mockResolvedValue(executionOwnedBy(TENANT_A, 'RUNNING'))
        const res = await buildApp().request(
          `/workflow-executions/${VALID_EXECUTION_ID}`,
          withToken(token, { status: 'COMPLETED' }, 'PATCH'),
        )
        expect(res.status).toBe(401)
        expect(mockExecRepo.markTerminal).not.toHaveBeenCalled()
      })
    }

    it('never queries credentials for a malformed token (parse rejects first)', async () => {
      await buildApp().request(
        '/workflow-runtime-token',
        withToken('garbage', { executionId: VALID_EXECUTION_ID }),
      )
      expect(mockCredentialFindUnique).not.toHaveBeenCalled()
    })

    // ---- header precedence --------------------------------------------------

    it('shared secret wins when both headers are present', async () => {
      mockExecutionFindUnique.mockResolvedValue(executionOwnedBy(TENANT_B))
      mockWorkflowFindUnique.mockResolvedValue({ runtimeTokenCiphertext: 'CT' })
      mockDecryptRuntimeToken.mockResolvedValue('vnd_TENANT_B_RUNTIME')
      const res = await buildApp().request('/workflow-runtime-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workflow-Broker-Secret': BROKER_SECRET,
          // A token for tenant A alongside the (full-access) shared secret:
          // the secret path authenticates, so tenant B's execution is reachable.
          'X-Workflow-Broker-Token': TENANT_A_TOKEN,
        },
        body: JSON.stringify({ executionId: VALID_EXECUTION_ID }),
      })
      expect(res.status).toBe(200)
    })

    it('an invalid shared secret never falls through to a valid token', async () => {
      mockExecutionFindUnique.mockResolvedValue(executionOwnedBy(TENANT_A))
      const res = await buildApp().request('/workflow-runtime-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workflow-Broker-Secret': 'wrong-secret',
          'X-Workflow-Broker-Token': TENANT_A_TOKEN,
        },
        body: JSON.stringify({ executionId: VALID_EXECUTION_ID }),
      })
      expect(res.status).toBe(401)
      expect((await json(res))['code']).toBe('INVALID_BROKER_SECRET')
    })
  })

  // ── POST /workflow-runtime-token ───────────────────────────────────────────

  describe('POST /workflow-runtime-token', () => {
    it('returns 400 on a non-UUID executionId', async () => {
      const res = await buildApp().request(
        '/workflow-runtime-token',
        withSecret(BROKER_SECRET, { executionId: 'not-a-uuid' }),
      )
      expect(res.status).toBe(400)
    })

    it('returns 404 when the execution row is missing', async () => {
      mockExecutionFindUnique.mockResolvedValue(null)
      const res = await buildApp().request(
        '/workflow-runtime-token',
        withSecret(BROKER_SECRET, { executionId: VALID_EXECUTION_ID }),
      )
      expect(res.status).toBe(404)
    })

    it('returns 404 when the execution is in a terminal state', async () => {
      mockExecutionFindUnique.mockResolvedValue({
        id: VALID_EXECUTION_ID,
        tenantId: 't1',
        workflowId: 'wf-1',
        status: 'COMPLETED',
      })
      const res = await buildApp().request(
        '/workflow-runtime-token',
        withSecret(BROKER_SECRET, { executionId: VALID_EXECUTION_ID }),
      )
      expect(res.status).toBe(404)
    })

    it('returns 404 when the workflow lacks a runtime ciphertext', async () => {
      mockExecutionFindUnique.mockResolvedValue({
        id: VALID_EXECUTION_ID,
        tenantId: 't1',
        workflowId: 'wf-1',
        status: 'RUNNING',
      })
      mockWorkflowFindUnique.mockResolvedValue({ runtimeTokenCiphertext: null })
      const res = await buildApp().request(
        '/workflow-runtime-token',
        withSecret(BROKER_SECRET, { executionId: VALID_EXECUTION_ID }),
      )
      expect(res.status).toBe(404)
    })

    it('returns the plaintext token on the happy path with Cache-Control: no-store', async () => {
      mockExecutionFindUnique.mockResolvedValue({
        id: VALID_EXECUTION_ID,
        tenantId: 't1',
        workflowId: 'wf-1',
        status: 'QUEUED',
      })
      mockWorkflowFindUnique.mockResolvedValue({
        runtimeTokenCiphertext: 'BASE64-CIPHERTEXT',
        name: 'my-workflow',
        version: '0.6.2',
      })
      mockDecryptRuntimeToken.mockResolvedValue('vnd_THE_PLAINTEXT_TOKEN')
      const res = await buildApp().request(
        '/workflow-runtime-token',
        withSecret(BROKER_SECRET, { executionId: VALID_EXECUTION_ID }),
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-store')
      const body = await json(res)
      expect(body['token']).toBe('vnd_THE_PLAINTEXT_TOKEN')
    })

    it('names the published row the execution is bound to (sdk-feedback 0034)', async () => {
      // This is the tenant runner's ONLY source for WHICH build to install:
      // the Temporal envelope carries just {executionId, input, dryRun}. Without
      // it the runner falls back to "latest for this name", which is how a warm
      // task came to serve stale bytes for its whole life.
      mockExecutionFindUnique.mockResolvedValue({
        id: VALID_EXECUTION_ID,
        tenantId: 't1',
        workflowId: 'wf-1',
        status: 'QUEUED',
      })
      mockWorkflowFindUnique.mockResolvedValue({
        runtimeTokenCiphertext: 'BASE64-CIPHERTEXT',
        name: 'my-workflow',
        version: '0.6.2',
      })
      mockDecryptRuntimeToken.mockResolvedValue('vnd_THE_PLAINTEXT_TOKEN')
      const res = await buildApp().request(
        '/workflow-runtime-token',
        withSecret(BROKER_SECRET, { executionId: VALID_EXECUTION_ID }),
      )
      const body = await json(res)
      expect(body['workflowId']).toBe('wf-1')
      expect(body['workflowName']).toBe('my-workflow')
      expect(body['workflowVersion']).toBe('0.6.2')
    })

    it('does not log the plaintext token', async () => {
      mockExecutionFindUnique.mockResolvedValue({
        id: VALID_EXECUTION_ID,
        tenantId: 't1',
        workflowId: 'wf-1',
        status: 'QUEUED',
      })
      mockWorkflowFindUnique.mockResolvedValue({
        runtimeTokenCiphertext: 'BASE64-CIPHERTEXT',
      })
      mockDecryptRuntimeToken.mockResolvedValue('vnd_THE_PLAINTEXT_TOKEN')
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
      const spy2 = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        await buildApp().request(
          '/workflow-runtime-token',
          withSecret(BROKER_SECRET, { executionId: VALID_EXECUTION_ID }),
        )
        const joined =
          spy.mock.calls.map((c) => JSON.stringify(c)).join('|') +
          spy2.mock.calls.map((c) => JSON.stringify(c)).join('|')
        expect(joined).not.toContain('vnd_THE_PLAINTEXT_TOKEN')
        expect(joined).not.toContain('BASE64-CIPHERTEXT')
      } finally {
        spy.mockRestore()
        spy2.mockRestore()
      }
    })
  })

  // ── PATCH /workflow-executions/:id ─────────────────────────────────────────

  describe('PATCH /workflow-executions/:id', () => {
    const baseRow = {
      id: VALID_EXECUTION_ID,
      tenantId: 't1',
      status: 'QUEUED' as const,
      finishedAt: null,
    }

    it('returns 404 when the row is missing', async () => {
      mockExecutionFindUnique.mockResolvedValue(null)
      const res = await buildApp().request(
        `/workflow-executions/${VALID_EXECUTION_ID}`,
        withSecret(BROKER_SECRET, { status: 'RUNNING' }, 'PATCH'),
      )
      expect(res.status).toBe(404)
    })

    it('rejects QUEUED → QUEUED', async () => {
      mockExecutionFindUnique.mockResolvedValue(baseRow)
      const res = await buildApp().request(
        `/workflow-executions/${VALID_EXECUTION_ID}`,
        withSecret(BROKER_SECRET, { status: 'QUEUED' }, 'PATCH'),
      )
      expect(res.status).toBe(400)
      expect((await json(res))['code']).toBe('INVALID_TRANSITION')
    })

    it('rejects a transition out of a terminal status', async () => {
      mockExecutionFindUnique.mockResolvedValue({ ...baseRow, status: 'COMPLETED' })
      const res = await buildApp().request(
        `/workflow-executions/${VALID_EXECUTION_ID}`,
        withSecret(BROKER_SECRET, { status: 'FAILED' }, 'PATCH'),
      )
      expect(res.status).toBe(400)
    })

    it('is idempotent on terminal self-transition', async () => {
      mockExecutionFindUnique.mockResolvedValue({ ...baseRow, status: 'COMPLETED' })
      mockExecRepo.findById.mockResolvedValue({ ...baseRow, status: 'COMPLETED' })
      const res = await buildApp().request(
        `/workflow-executions/${VALID_EXECUTION_ID}`,
        withSecret(BROKER_SECRET, { status: 'COMPLETED' }, 'PATCH'),
      )
      expect(res.status).toBe(200)
      expect(mockExecRepo.markTerminal).not.toHaveBeenCalled()
      expect(mockExecRepo.markStarted).not.toHaveBeenCalled()
    })

    it('rejects a RUNNING transition without temporal ids', async () => {
      mockExecutionFindUnique.mockResolvedValue(baseRow)
      const res = await buildApp().request(
        `/workflow-executions/${VALID_EXECUTION_ID}`,
        withSecret(BROKER_SECRET, { status: 'RUNNING' }, 'PATCH'),
      )
      expect(res.status).toBe(400)
      expect((await json(res))['code']).toBe('VALIDATION_ERROR')
    })

    it('marks RUNNING with the supplied temporal ids', async () => {
      mockExecutionFindUnique.mockResolvedValue(baseRow)
      mockExecRepo.markStarted.mockResolvedValue({
        ...baseRow,
        status: 'RUNNING',
        startedAt: new Date('2026-06-06T10:00:00Z'),
        temporalWorkflowId: 'wf-tid',
        temporalRunId: 'run-1',
      })
      const res = await buildApp().request(
        `/workflow-executions/${VALID_EXECUTION_ID}`,
        withSecret(
          BROKER_SECRET,
          {
            status: 'RUNNING',
            temporalWorkflowId: 'wf-tid',
            temporalRunId: 'run-1',
            startedAt: '2026-06-06T10:00:00Z',
          },
          'PATCH',
        ),
      )
      expect(res.status).toBe(200)
      expect(mockExecRepo.markStarted).toHaveBeenCalledWith(
        VALID_EXECUTION_ID,
        expect.objectContaining({
          temporalWorkflowId: 'wf-tid',
          temporalRunId: 'run-1',
        }),
      )
    })

    it('marks COMPLETED with the supplied result + finishedAt', async () => {
      mockExecutionFindUnique.mockResolvedValue({ ...baseRow, status: 'RUNNING' })
      mockExecRepo.markTerminal.mockResolvedValue({
        ...baseRow,
        status: 'COMPLETED',
        finishedAt: new Date('2026-06-06T10:05:00Z'),
      })
      const res = await buildApp().request(
        `/workflow-executions/${VALID_EXECUTION_ID}`,
        withSecret(
          BROKER_SECRET,
          {
            status: 'COMPLETED',
            result: { message: 'ok' },
            finishedAt: '2026-06-06T10:05:00Z',
          },
          'PATCH',
        ),
      )
      expect(res.status).toBe(200)
      expect(mockExecRepo.markTerminal).toHaveBeenCalledWith(
        VALID_EXECUTION_ID,
        expect.objectContaining({
          status: 'COMPLETED',
          result: { message: 'ok' },
        }),
      )
    })

    it('marks FAILED with the supplied errorMessage', async () => {
      mockExecutionFindUnique.mockResolvedValue({ ...baseRow, status: 'RUNNING' })
      mockExecRepo.markTerminal.mockResolvedValue({
        ...baseRow,
        status: 'FAILED',
        finishedAt: new Date('2026-06-06T10:05:00Z'),
      })
      const res = await buildApp().request(
        `/workflow-executions/${VALID_EXECUTION_ID}`,
        withSecret(BROKER_SECRET, { status: 'FAILED', errorMessage: 'boom' }, 'PATCH'),
      )
      expect(res.status).toBe(200)
      expect(mockExecRepo.markTerminal).toHaveBeenCalledWith(
        VALID_EXECUTION_ID,
        expect.objectContaining({ status: 'FAILED', errorMessage: 'boom' }),
      )
    })

    it('allows QUEUED → terminal (fail before reaching RUNNING)', async () => {
      mockExecutionFindUnique.mockResolvedValue(baseRow)
      mockExecRepo.markTerminal.mockResolvedValue({
        ...baseRow,
        status: 'FAILED',
        finishedAt: new Date('2026-06-06T10:00:00Z'),
      })
      const res = await buildApp().request(
        `/workflow-executions/${VALID_EXECUTION_ID}`,
        withSecret(BROKER_SECRET, { status: 'FAILED', errorMessage: 'never started' }, 'PATCH'),
      )
      expect(res.status).toBe(200)
    })
  })

  // ── GET /tenant-workflows (Phase 3 Unit 8) ─────────────────────────────────

  describe('GET /tenant-workflows', () => {
    const workflowRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'wf-00000000-0000-4000-8000-00000000000a',
      name: 'my_workflow',
      version: '1.0.0',
      manifest: {
        name: 'my_workflow',
        version: '1.0.0',
        entryPoints: ['my_workflow.workflow:MyWorkflow'],
      },
      artifactKey: 'workflows/t/wf/1.0.0.zip',
      artifactSha256: 'a'.repeat(64),
      artifactSizeBytes: 12_345,
      createdAt: new Date('2026-06-11T00:00:00Z'),
      ...overrides,
    })

    function getTenantWorkflows(headers: Record<string, string>, query = '') {
      return buildApp().request(`/tenant-workflows${query}`, { method: 'GET', headers })
    }

    beforeEach(() => {
      stubCredentials()
      mockWorkflowFindMany.mockResolvedValue([workflowRow()])
      mockPresignDownload.mockResolvedValue('https://s3.example/presigned-get')
    })

    // ---- auth matrix --------------------------------------------------------

    it('401s with no credential at all', async () => {
      const res = await getTenantWorkflows({})
      expect(res.status).toBe(401)
      expect(mockWorkflowFindMany).not.toHaveBeenCalled()
    })

    it('401s an invalid token', async () => {
      const res = await getTenantWorkflows({
        'X-Workflow-Broker-Token': `wbk_${TENANT_A}_${'ef'.repeat(24)}`, // rotated/stale
      })
      expect(res.status).toBe(401)
      expect((await json(res))['code']).toBe('INVALID_BROKER_TOKEN')
      expect(mockWorkflowFindMany).not.toHaveBeenCalled()
    })

    it('401s an invalid shared secret without falling through to the token', async () => {
      const res = await getTenantWorkflows({
        'X-Workflow-Broker-Secret': 'wrong-secret',
        'X-Workflow-Broker-Token': TENANT_A_TOKEN,
      })
      expect(res.status).toBe(401)
      expect((await json(res))['code']).toBe('INVALID_BROKER_SECRET')
    })

    it("lists the token tenant's own executable workflows", async () => {
      const res = await getTenantWorkflows({ 'X-Workflow-Broker-Token': TENANT_A_TOKEN })
      expect(res.status).toBe(200)
      // The where clause IS the tenant scope + executability + digest gate.
      expect(mockWorkflowFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: TENANT_A,
            executable: true,
            artifactSha256: { not: null },
          },
        }),
      )
      const body = await json(res)
      const data = body['data'] as Array<Record<string, unknown>>
      expect(data).toHaveLength(1)
      expect(data[0]).toMatchObject({
        name: 'my_workflow',
        version: '1.0.0',
        entryPoints: ['my_workflow.workflow:MyWorkflow'],
        artifactSha256: 'a'.repeat(64),
        artifactSizeBytes: 12_345,
        downloadUrl: 'https://s3.example/presigned-get',
        downloadUrlExpiresInSeconds: 300,
      })
      expect(mockPresignDownload).toHaveBeenCalledWith('workflows/t/wf/1.0.0.zip')
      // The raw S3 key never appears as a response field.
      expect(data[0]).not.toHaveProperty('artifactKey')
    })

    it("400s a token tenant asking for ANOTHER tenant's listing", async () => {
      const res = await getTenantWorkflows(
        { 'X-Workflow-Broker-Token': TENANT_A_TOKEN },
        `?tenantId=${TENANT_B}`,
      )
      expect(res.status).toBe(400)
      expect(mockWorkflowFindMany).not.toHaveBeenCalled()
    })

    it('accepts a token tenant naming ITSELF explicitly', async () => {
      const res = await getTenantWorkflows(
        { 'X-Workflow-Broker-Token': TENANT_A_TOKEN },
        `?tenantId=${TENANT_A}`,
      )
      expect(res.status).toBe(200)
      expect(mockWorkflowFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT_A }) }),
      )
    })

    it('lets the shared secret list any tenant via the query param', async () => {
      const res = await getTenantWorkflows(
        { 'X-Workflow-Broker-Secret': BROKER_SECRET },
        `?tenantId=${TENANT_B}`,
      )
      expect(res.status).toBe(200)
      expect(mockWorkflowFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT_B }) }),
      )
    })

    it('400s the shared secret without a tenantId param', async () => {
      const res = await getTenantWorkflows({ 'X-Workflow-Broker-Secret': BROKER_SECRET })
      expect(res.status).toBe(400)
      expect(mockWorkflowFindMany).not.toHaveBeenCalled()
    })

    it('400s the shared secret with a non-uuid tenantId param', async () => {
      const res = await getTenantWorkflows(
        { 'X-Workflow-Broker-Secret': BROKER_SECRET },
        '?tenantId=not-a-uuid',
      )
      expect(res.status).toBe(400)
    })

    // ---- response hygiene ---------------------------------------------------

    it('skips rows whose stored manifest lacks entry points', async () => {
      mockWorkflowFindMany.mockResolvedValue([
        workflowRow(),
        workflowRow({ id: 'wf-broken', name: 'broken_wf', manifest: { entryPoints: [] } }),
        workflowRow({ id: 'wf-null-manifest', name: 'null_wf', manifest: null }),
      ])
      const res = await getTenantWorkflows({ 'X-Workflow-Broker-Token': TENANT_A_TOKEN })
      expect(res.status).toBe(200)
      const data = (await json(res))['data'] as Array<Record<string, unknown>>
      expect(data.map((d) => d['name'])).toEqual(['my_workflow'])
    })

    it('returns an empty list when the tenant has no executable workflows', async () => {
      mockWorkflowFindMany.mockResolvedValue([])
      const res = await getTenantWorkflows({ 'X-Workflow-Broker-Token': TENANT_A_TOKEN })
      expect(res.status).toBe(200)
      expect((await json(res))['data']).toEqual([])
      expect(mockPresignDownload).not.toHaveBeenCalled()
    })

    it('sets Cache-Control: no-store (presigned URLs are credentials)', async () => {
      const res = await getTenantWorkflows({ 'X-Workflow-Broker-Token': TENANT_A_TOKEN })
      expect(res.headers.get('cache-control')).toBe('no-store')
    })
  })
})
