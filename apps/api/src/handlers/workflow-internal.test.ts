// ---------------------------------------------------------------------------
// Unit tests for the internal worker handler.
//
// Covers:
//   - Header-secret enforcement (missing / wrong / right) on BOTH endpoints.
//   - POST /workflow-runtime-token: happy path, missing execution, terminal-
//     execution refusal, no token in logs, Cache-Control: no-store.
//   - PATCH /workflow-executions/:id: state-machine validation, idempotent
//     terminal-self transition, RUNNING write, terminal write.
//
// Strategy: mock the `db` module (so no real Prisma is needed) and the
// runtime-token-crypto + tenant-scoped Prisma helpers. The validator and
// shared-secret middleware are exercised via real HTTP-shaped requests.
// ---------------------------------------------------------------------------

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
  mockExecRepo,
  mockDecryptRuntimeToken,
} = vi.hoisted(() => ({
  mockExecutionFindUnique: vi.fn(),
  mockWorkflowFindUnique: vi.fn(),
  mockExecRepo: {
    findById: vi.fn(),
    markStarted: vi.fn(),
    markTerminal: vi.fn(),
  },
  mockDecryptRuntimeToken: vi.fn(),
}))

vi.mock('../db', () => ({
  db: {
    workflowExecution: { findUnique: mockExecutionFindUnique },
    workflow: { findUnique: mockWorkflowFindUnique },
  } as unknown as PrismaClient,
}))

vi.mock('../lib/runtime-token-crypto', () => ({
  decryptRuntimeToken: mockDecryptRuntimeToken,
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
        withSecret(
          BROKER_SECRET,
          { status: 'FAILED', errorMessage: 'boom' },
          'PATCH',
        ),
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
        withSecret(
          BROKER_SECRET,
          { status: 'FAILED', errorMessage: 'never started' },
          'PATCH',
        ),
      )
      expect(res.status).toBe(200)
    })
  })
})
