// ---------------------------------------------------------------------------
// Unit tests for the workflows handler
//
// createWorkflowRepository is mocked so no DB is required.
// presignUpload / presignDownload are mocked so no AWS SDK is called.
// dualAuthMiddleware is mocked with a context-injecting stub — buildApp picks
// the roleNames/userId per test (the real dispatch is covered by dual-auth.test.ts).
// requirePermission is NOT mocked — the real implementation enforces RBAC.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { _clearAuthzCache } from '../lib/authz'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockRepo,
  mockApiClientRepo,
  mockExecutionRepo,
  mockTriggerRepo,
  mockEventTypeRepo,
  mockTenantFindUnique,
  mockTenantUserCreate,
  mockPresignUpload,
  mockPresignDownload,
  mockCopyObject,
  mockHeadObject,
  mockGetObjectBuffer,
  mockEncryptRuntimeToken,
  mockGetTemporalClient,
  mockTemporalStart,
  mockGetHandle,
  mockHandleCancel,
  mockHandleFetchHistory,
} = vi.hoisted(() => {
  const start = vi.fn()
  const handleCancel = vi.fn()
  const handleFetchHistory = vi.fn()
  const getHandle = vi.fn(() => ({
    cancel: handleCancel,
    fetchHistory: handleFetchHistory,
  }))
  const client = { workflow: { start, getHandle } }
  return {
    mockRepo: {
      create: vi.fn(),
      findByIdForTenant: vi.fn(),
      listForTenant: vi.fn(),
      findByNaturalKey: vi.fn(),
      forkGlobalToTenant: vi.fn(),
      attachRuntimeToken: vi.fn(),
    },
    mockApiClientRepo: {
      create: vi.fn(),
    },
    mockExecutionRepo: {
      create: vi.fn(),
      findById: vi.fn(),
      listByWorkflow: vi.fn(),
      markStarted: vi.fn(),
      markTerminal: vi.fn(),
    },
    mockTriggerRepo: {
      create: vi.fn(),
      findById: vi.fn(),
      listByWorkflow: vi.fn(),
      update: vi.fn(),
      deleteById: vi.fn(),
    },
    mockEventTypeRepo: {
      findByName: vi.fn(),
    },
    mockTenantFindUnique: vi.fn(),
    mockTenantUserCreate: vi.fn(),
    mockPresignUpload: vi.fn(),
    mockPresignDownload: vi.fn(),
    mockCopyObject: vi.fn(),
    mockHeadObject: vi.fn(),
    mockGetObjectBuffer: vi.fn(),
    mockEncryptRuntimeToken: vi.fn(),
    mockGetTemporalClient: vi.fn(async () => client),
    mockTemporalStart: start,
    mockGetHandle: getHandle,
    mockHandleCancel: handleCancel,
    mockHandleFetchHistory: handleFetchHistory,
  }
})

vi.mock('../repositories/workflow.repository', () => ({
  createWorkflowRepository: vi.fn(() => mockRepo),
}))

vi.mock('../repositories/api-client.repository', () => ({
  createApiClientRepository: vi.fn(() => mockApiClientRepo),
}))

// Preserve real exports (notably TERMINAL_STATUSES, used by the cancel
// endpoint) and override only the repository factory.
vi.mock('../repositories/workflow-execution.repository', async (importActual) => {
  const actual = (await importActual()) as Record<string, unknown>
  return { ...actual, createWorkflowExecutionRepository: vi.fn(() => mockExecutionRepo) }
})

vi.mock('../repositories/workflow-trigger.repository', () => ({
  createWorkflowTriggerRepository: vi.fn(() => mockTriggerRepo),
}))

vi.mock('../repositories/tenant-event-type.repository', () => ({
  createTenantEventTypeRepository: vi.fn(() => mockEventTypeRepo),
}))

// The requirements-summary endpoint reads the secret/config store via this repo.
const mockSecretConfigRepo = vi.hoisted(() => ({ listByKind: vi.fn() }))
vi.mock('../repositories/workflow-secret-config.repository', () => ({
  createWorkflowSecretConfigRepository: vi.fn(() => mockSecretConfigRepo),
}))

// Keep the real module (notably summarizeWorkflowHistory, used by the history
// endpoint, and temporalTaskQueue) and override only the client constructor so
// no real Temporal connection is opened.
vi.mock('../lib/temporal-client', async (importActual) => {
  const actual = (await importActual()) as Record<string, unknown>
  return { ...actual, getTemporalClient: mockGetTemporalClient }
})

vi.mock('../lib/documents-s3', () => ({
  presignUpload: mockPresignUpload,
  presignDownload: mockPresignDownload,
  copyObject: mockCopyObject,
  headObject: mockHeadObject,
  getObjectBuffer: mockGetObjectBuffer,
}))

// KMS crypto is mocked so no real AWS call is made — the handler must still
// pass the returned ciphertext through to attachRuntimeToken.
vi.mock('../lib/runtime-token-crypto', () => ({
  encryptRuntimeToken: mockEncryptRuntimeToken,
}))

// dualAuthMiddleware is replaced with a context-injecting stub — its real
// dispatch (Cognito vs vnd_ vs SKIP_AUTH) is covered by dual-auth.test.ts.
vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

import { workflowsHandler } from './workflows'
import { dualAuthMiddleware } from '../middleware/dual-auth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>

async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function patch(body: unknown): RequestInit {
  return {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function del(): RequestInit {
  return { method: 'DELETE' }
}

function buildApp(
  roleNames: readonly string[] = ['tenant_admin'],
  userId: string | null = 'user-1',
) {
  // `$transaction` runs the callback with `tx === fakeDb` itself, so the
  // workflow + api-client repos and tenantUser.create resolve against the
  // same fakeDb mocks regardless of the transaction wrapping.
  const fakeDb = {
    tenant: { findUnique: mockTenantFindUnique },
    tenantUser: { create: mockTenantUserCreate },
    workflow: { update: vi.fn() },
  } as unknown as PrismaClient
  ;(fakeDb as unknown as { $transaction: unknown }).$transaction = vi.fn(
    (cb: (tx: unknown) => unknown) => cb(fakeDb),
  )
  // Stub dualAuthMiddleware to inject the AppEnv context both tenantMiddleware
  // and m2mAppAuthMiddleware would populate in production.
  vi.mocked(dualAuthMiddleware).mockImplementation(async (c, next) => {
    c.set('tenantId', 'test-tenant-id')
    c.set('principal', { sub: 'test-sub', tenantId: 'test-tenant-id', roleNames: [...roleNames] })
    c.set('idToken', undefined)
    c.set('policyStoreId', undefined)
    c.set('db', fakeDb)
    c.set('userId', userId ?? undefined)
    await next()
  })
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.route('/', workflowsHandler)
  return app
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date('2026-05-13T12:00:00Z')

// A REAL artifact zip produced by the SDK packaging code against
// packages/workflows-stdlib (see __tests__/fixtures/workflow-artifacts/).
// The finalize path downloads + validates the artifact since Phase 3 Unit 6,
// so the default S3 mocks below serve these bytes.
const validArtifactZip = readFileSync(
  join(
    __dirname,
    '..',
    '__tests__',
    'fixtures',
    'workflow-artifacts',
    'stdlib-send-quote-followup.zip',
  ),
)
const validArtifactSha256 = createHash('sha256').update(validArtifactZip).digest('hex')

const validDiagram = [
  'flowchart TD',
  '  A[Quote sent] --> B[Wait 3 days]',
  '  B --> C{Accepted?}',
  '  C -->|No| D[Email follow-up]',
  '  C -->|Yes| E[Done]',
].join('\n')

const validManifest = {
  name: 'send_quote_followup',
  version: '1.0.0',
  // Must resolve inside validArtifactZip (send_quote_followup/workflow.py).
  entryPoints: ['send_quote_followup.workflow:SendQuoteFollowup'],
  description: 'Email a follow-up to the customer 3 days after a quote is sent.',
  // Required since workflow visualization — the SDK embeds a Mermaid flowchart.
  diagram: validDiagram,
}

const mockRow = {
  id: 'wf-1',
  tenantId: 'test-tenant-id',
  name: validManifest.name,
  version: validManifest.version,
  visibility: 'TENANT' as const,
  artifactKey: 'workflows/test-tenant-id/wf-1/1.0.0.zip',
  manifest: validManifest,
  createdByUserId: 'user-1',
  forkedFromWorkflowId: null,
  forkedFromVersion: null,
  runtimeTokenCiphertext: null,
  runtimeApiClientId: null,
  artifactSha256: validArtifactSha256,
  artifactSizeBytes: validArtifactZip.length,
  executable: true,
  createdAt: now,
  updatedAt: now,
}

/** A workflow row as it looks after the runtime service account is provisioned. */
const provisionedRow = {
  ...mockRow,
  runtimeTokenCiphertext: 'BASE64-CIPHERTEXT',
  runtimeApiClientId: 'api-client-1',
}

const globalRow = {
  ...mockRow,
  id: 'global-wf-1',
  tenantId: 'platform-tenant-id',
  visibility: 'GLOBAL' as const,
  artifactKey: 'workflows/platform-tenant-id/global-wf-1/1.0.0.zip',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('workflows handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['AUTHZ_OFFLINE'] = 'true'
    _clearAuthzCache()
    mockPresignUpload.mockResolvedValue('https://s3.example/put?sig=abc')
    mockPresignDownload.mockResolvedValue('https://s3.example/get?sig=xyz')
    // Artifact-validation happy path: HEAD finds a small object, GET serves
    // the real SDK-produced zip whose entry point matches validManifest.
    mockHeadObject.mockResolvedValue({ sizeBytes: validArtifactZip.length })
    mockGetObjectBuffer.mockResolvedValue(validArtifactZip)
    // Default runtime-provisioning happy path — the finalize/fork tests that
    // don't care about provisioning still need these to resolve.
    mockTenantUserCreate.mockResolvedValue({ id: 'svc-user-1' })
    mockApiClientRepo.create.mockResolvedValue({
      row: { id: 'api-client-1', keyPrefix: 'vnd_abcd1234' },
      plainKey: 'vnd_THIS_IS_THE_PLAINTEXT_KEY',
    })
    mockEncryptRuntimeToken.mockResolvedValue('BASE64-CIPHERTEXT')
    mockRepo.attachRuntimeToken.mockResolvedValue(provisionedRow)
    // Custom event-type registry: default to "not registered" so a non-built-in
    // eventType is rejected unless a test opts in by returning an enabled row.
    mockEventTypeRepo.findByName.mockResolvedValue(null)
    // Secret/config store defaults to empty so requirements resolve as missing
    // unless a test opts in.
    mockSecretConfigRepo.listByKind.mockResolvedValue([])
  })

  // ── RBAC ──────────────────────────────────────────────────────────────────

  describe('RBAC', () => {
    it('returns 403 when uploading without workflow_developer role', async () => {
      const res = await buildApp(['viewer']).request(
        '/upload-url',
        post({ name: 'x', version: '1.0.0', sizeBytes: 1024 }),
      )
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })

    it('returns 403 on POST / without workflow_developer role', async () => {
      const res = await buildApp(['viewer']).request(
        '/',
        post({ workflowId: '00000000-0000-0000-0000-000000000001', manifest: validManifest }),
      )
      expect(res.status).toBe(403)
    })

    it('returns 403 listing when principal has no roles', async () => {
      const res = await buildApp([]).request('/')
      expect(res.status).toBe(403)
    })

    it('allows tenant_user to list (read baseline includes workflow:read)', async () => {
      mockRepo.listForTenant.mockResolvedValue([mockRow])
      const res = await buildApp(['viewer']).request('/')
      expect(res.status).toBe(200)
    })

    it('allows workflow_developer to upload', async () => {
      mockRepo.findByNaturalKey.mockResolvedValue(null)
      const res = await buildApp(['workflow_developer']).request(
        '/upload-url',
        post({ name: validManifest.name, version: validManifest.version, sizeBytes: 1024 }),
      )
      expect(res.status).toBe(201)
    })
  })

  // ── POST /upload-url ──────────────────────────────────────────────────────

  describe('POST /upload-url', () => {
    it('returns 400 on invalid name', async () => {
      const res = await buildApp().request(
        '/upload-url',
        post({ name: 'Has Spaces', version: '1.0.0', sizeBytes: 1024 }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 on invalid version', async () => {
      const res = await buildApp().request(
        '/upload-url',
        post({ name: 'wf', version: 'not-semver', sizeBytes: 1024 }),
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 when sizeBytes exceeds limit', async () => {
      const res = await buildApp().request(
        '/upload-url',
        post({ name: 'wf', version: '1.0.0', sizeBytes: 999_999_999 }),
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 just above the 10 MB cap (same cap finalize enforces)', async () => {
      const res = await buildApp().request(
        '/upload-url',
        post({ name: 'wf', version: '1.0.0', sizeBytes: 10 * 1024 * 1024 + 1 }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 409 when (tenant, name, version) already exists', async () => {
      mockRepo.findByNaturalKey.mockResolvedValue(mockRow)
      const res = await buildApp().request(
        '/upload-url',
        post({ name: validManifest.name, version: validManifest.version, sizeBytes: 1024 }),
      )
      expect(res.status).toBe(409)
      expect((await json(res)).code).toBe('CONFLICT')
    })

    it('returns 201 with workflowId + uploadUrl on success', async () => {
      mockRepo.findByNaturalKey.mockResolvedValue(null)
      const res = await buildApp().request(
        '/upload-url',
        post({ name: validManifest.name, version: validManifest.version, sizeBytes: 2048 }),
      )
      expect(res.status).toBe(201)
      const body = (await json(res)).data as JsonBody
      expect(typeof body['workflowId']).toBe('string')
      expect(body['uploadUrl']).toBe('https://s3.example/put?sig=abc')
      expect(body['expiresInSeconds']).toBe(15 * 60)
      // S3 key path is server-derived and never leaks to the response.
      expect('artifactKey' in body).toBe(false)
    })
  })

  // ── GET /requirements-summary ─────────────────────────────────────────────

  describe('GET /requirements-summary', () => {
    it('tags each declared key present/missing and totals the gaps', async () => {
      mockRepo.listForTenant.mockResolvedValue([
        {
          ...mockRow,
          id: 'wf-a',
          name: 'a',
          manifest: {
            ...validManifest,
            requiredSecrets: [
              { key: 'STRIPE_API_KEY', group: 'billing' },
              { key: 'MISSING_SECRET' },
            ],
            requiredConfigs: [{ key: 'DEFAULT_REGION' }],
          },
        },
        { ...mockRow, id: 'wf-b', name: 'b', manifest: validManifest },
      ])
      mockSecretConfigRepo.listByKind.mockImplementation((kind: string) =>
        kind === 'SECRET'
          ? Promise.resolve([{ group: 'billing', key: 'STRIPE_API_KEY' }])
          : Promise.resolve([{ group: 'global', key: 'DEFAULT_REGION' }]),
      )

      const res = await buildApp(['viewer']).request('/requirements-summary')
      expect(res.status).toBe(200)
      const data = (await json(res)).data as {
        totalMissing: number
        workflows: Array<{
          workflowId: string
          missingCount: number
          requirements: Array<Record<string, unknown>>
        }>
      }
      expect(data.totalMissing).toBe(1)
      const a = data.workflows.find((w) => w.workflowId === 'wf-a')!
      expect(a.missingCount).toBe(1)
      expect(a.requirements).toEqual([
        {
          kind: 'SECRET',
          key: 'STRIPE_API_KEY',
          group: 'billing',
          description: null,
          present: true,
        },
        {
          kind: 'SECRET',
          key: 'MISSING_SECRET',
          group: 'global',
          description: null,
          present: false,
        },
        {
          kind: 'CONFIG',
          key: 'DEFAULT_REGION',
          group: 'global',
          description: null,
          present: true,
        },
      ])
      const b = data.workflows.find((w) => w.workflowId === 'wf-b')!
      expect(b.requirements).toEqual([])
    })

    it('is the literal path, not captured by GET /:id', async () => {
      mockRepo.listForTenant.mockResolvedValue([])
      const res = await buildApp(['viewer']).request('/requirements-summary')
      expect(res.status).toBe(200)
      expect(mockRepo.findByIdForTenant).not.toHaveBeenCalled()
    })

    it('returns 403 without the ReadWorkflow permission', async () => {
      const res = await buildApp([]).request('/requirements-summary')
      expect(res.status).toBe(403)
    })
  })

  // ── POST / (finalize) ─────────────────────────────────────────────────────

  describe('POST /', () => {
    const workflowId = 'a1b2c3d4-e5f6-4789-89ab-cdef01234567'

    it('returns 400 on invalid manifest', async () => {
      const res = await buildApp().request(
        '/',
        post({ workflowId, manifest: { name: 'x', version: 'bad', entryPoints: ['x'] } }),
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 on invalid workflowId', async () => {
      const res = await buildApp().request(
        '/',
        post({ workflowId: 'not-a-uuid', manifest: validManifest }),
      )
      expect(res.status).toBe(400)
    })

    it('accepts a manifest with known requiredActions', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: false })
      mockRepo.create.mockResolvedValue(mockRow)
      const res = await buildApp().request(
        '/',
        post({
          workflowId,
          manifest: { ...validManifest, requiredActions: ['ReadQuote', 'CreateEvent'] },
        }),
      )
      expect(res.status).toBe(201)
    })

    it('returns 400 VALIDATION_ERROR on a manifest with an unknown requiredActions id', async () => {
      const res = await buildApp().request(
        '/',
        post({
          workflowId,
          manifest: { ...validManifest, requiredActions: ['ReadQuote', 'NotARealAction'] },
        }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('accepts and persists requiredSecrets/requiredConfigs (group defaults to "global")', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: false })
      mockRepo.create.mockResolvedValue(mockRow)
      const res = await buildApp().request(
        '/',
        post({
          workflowId,
          manifest: {
            ...validManifest,
            requiredSecrets: [{ key: 'STRIPE_API_KEY', group: 'billing' }, { key: 'SENDGRID_KEY' }],
            requiredConfigs: [{ key: 'DEFAULT_REGION' }],
          },
        }),
      )
      expect(res.status).toBe(201)
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          manifest: expect.objectContaining({
            requiredSecrets: [
              { key: 'STRIPE_API_KEY', group: 'billing' },
              { key: 'SENDGRID_KEY', group: 'global' },
            ],
            requiredConfigs: [{ key: 'DEFAULT_REGION', group: 'global' }],
          }),
        }),
      )
    })

    it('returns 400 VALIDATION_ERROR on a requiredSecrets entry with a malformed key', async () => {
      const res = await buildApp().request(
        '/',
        post({ workflowId, manifest: { ...validManifest, requiredSecrets: [{ key: '1bad' }] } }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when the manifest has no diagram', async () => {
      const { diagram: _omitted, ...noDiagram } = validManifest
      const res = await buildApp().request('/', post({ workflowId, manifest: noDiagram }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when the diagram is an empty string', async () => {
      const res = await buildApp().request(
        '/',
        post({ workflowId, manifest: { ...validManifest, diagram: '' } }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('persists and returns the embedded Mermaid diagram', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: false })
      mockRepo.create.mockResolvedValue(mockRow)
      const res = await buildApp().request('/', post({ workflowId, manifest: validManifest }))
      expect(res.status).toBe(201)
      // Stored verbatim inside the manifest column…
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ manifest: expect.objectContaining({ diagram: validDiagram }) }),
      )
      // …and surfaced in the response for the tenant UI to render.
      const body = await json(res)
      expect((body.data as { manifest: { diagram: string } }).manifest.diagram).toBe(validDiagram)
    })

    it('writes a TENANT-visibility row when tenant is not the platform tenant', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: false })
      mockRepo.create.mockResolvedValue({ ...mockRow, visibility: 'TENANT' })
      mockRepo.attachRuntimeToken.mockResolvedValue({ ...provisionedRow, visibility: 'TENANT' })
      const res = await buildApp().request('/', post({ workflowId, manifest: validManifest }))
      expect(res.status).toBe(201)
      const body = (await json(res)).data as JsonBody
      expect(body['visibility']).toBe('TENANT')
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'TENANT', tenantId: 'test-tenant-id' }),
      )
    })

    it('writes a GLOBAL-visibility row when tenant is flagged isPlatformTenant', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: true })
      mockRepo.create.mockResolvedValue({ ...mockRow, visibility: 'GLOBAL' })
      mockRepo.attachRuntimeToken.mockResolvedValue({ ...provisionedRow, visibility: 'GLOBAL' })
      const res = await buildApp().request('/', post({ workflowId, manifest: validManifest }))
      expect(res.status).toBe(201)
      const body = (await json(res)).data as JsonBody
      expect(body['visibility']).toBe('GLOBAL')
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'GLOBAL' }),
      )
    })

    it('returns 409 CONFLICT on unique-constraint violation (P2002)', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: false })
      mockRepo.create.mockRejectedValue(Object.assign(new Error('Unique'), { code: 'P2002' }))
      const res = await buildApp().request('/', post({ workflowId, manifest: validManifest }))
      expect(res.status).toBe(409)
      expect((await json(res)).code).toBe('CONFLICT')
    })

    it('returns 422 when no authenticated user (UNAUTHENTICATED DomainError)', async () => {
      const res = await buildApp(['tenant_admin'], null).request(
        '/',
        post({ workflowId, manifest: validManifest }),
      )
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('UNAUTHENTICATED')
    })

    it('strips artifactKey from the response', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: false })
      mockRepo.create.mockResolvedValue(mockRow)
      const res = await buildApp().request('/', post({ workflowId, manifest: validManifest }))
      const body = (await json(res)).data as JsonBody
      expect('artifactKey' in body).toBe(false)
    })

    it('provisions a runtime service account and persists a non-null ciphertext', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: false })
      mockRepo.create.mockResolvedValue(mockRow)
      const res = await buildApp().request('/', post({ workflowId, manifest: validManifest }))
      expect(res.status).toBe(201)

      // Service-account TenantUser created: cognito-less, workflow_runtime role.
      expect(mockTenantUserCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cognitoSub: null,
            isServiceAccount: true,
            status: 'ACTIVE',
            roleNames: ['workflow_runtime'],
          }),
        }),
      )
      // ApiClient minted with the wf-runtime-<id> name, bound to the svc user.
      expect(mockApiClientRepo.create).toHaveBeenCalledWith(
        'test-tenant-id',
        expect.stringMatching(/^wf-runtime-/),
        [],
        'user-1',
        expect.any(String),
      )
      // Plaintext key was KMS-encrypted and the ciphertext + client id persisted.
      expect(mockEncryptRuntimeToken).toHaveBeenCalledWith('vnd_THIS_IS_THE_PLAINTEXT_KEY')
      // The provisioning step keys off the created row's id (mockRow.id).
      expect(mockRepo.attachRuntimeToken).toHaveBeenCalledWith(
        'wf-1',
        { runtimeTokenCiphertext: 'BASE64-CIPHERTEXT', runtimeApiClientId: 'api-client-1' },
        expect.anything(),
      )
    })

    it('never exposes the runtime plaintext key or ciphertext in the response', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: false })
      mockRepo.create.mockResolvedValue(mockRow)
      const res = await buildApp().request('/', post({ workflowId, manifest: validManifest }))
      const raw = await res.text()
      expect(raw).not.toContain('vnd_THIS_IS_THE_PLAINTEXT_KEY')
      expect(raw).not.toContain('BASE64-CIPHERTEXT')
      const body = JSON.parse(raw).data as JsonBody
      expect('runtimeTokenCiphertext' in body).toBe(false)
      expect('runtimeApiClientId' in body).toBe(false)
      expect('plainKey' in body).toBe(false)
    })

    // ── Artifact integrity (Phase 3 Unit 6) ────────────────────────────────

    it('persists artifactSha256/artifactSizeBytes/executable on success', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: false })
      mockRepo.create.mockResolvedValue(mockRow)
      const res = await buildApp().request('/', post({ workflowId, manifest: validManifest }))
      expect(res.status).toBe(201)
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          artifactSha256: validArtifactSha256,
          artifactSizeBytes: validArtifactZip.length,
          executable: true,
        }),
      )
      // Integrity facts are additive response fields.
      const body = (await json(res)).data as JsonBody
      expect(body['executable']).toBe(true)
      expect(body['artifactSha256']).toBe(validArtifactSha256)
      expect('artifactKey' in body).toBe(false)
    })

    it('returns 422 ARTIFACT_INVALID when the artifact was never uploaded', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: false })
      mockHeadObject.mockResolvedValue(null)
      const res = await buildApp().request('/', post({ workflowId, manifest: validManifest }))
      expect(res.status).toBe(422)
      const body = await json(res)
      expect(body.code).toBe('ARTIFACT_INVALID')
      expect(Array.isArray(body.problems)).toBe(true)
      expect(mockGetObjectBuffer).not.toHaveBeenCalled()
      expect(mockRepo.create).not.toHaveBeenCalled()
    })

    it('returns 422 ARTIFACT_TOO_LARGE from the HEAD pre-check without downloading', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: false })
      mockHeadObject.mockResolvedValue({ sizeBytes: 10 * 1024 * 1024 + 1 })
      const res = await buildApp().request('/', post({ workflowId, manifest: validManifest }))
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('ARTIFACT_TOO_LARGE')
      expect(mockGetObjectBuffer).not.toHaveBeenCalled()
      expect(mockRepo.create).not.toHaveBeenCalled()
    })

    it('returns 422 ARTIFACT_INVALID with problems when the artifact is not a zip', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: false })
      mockGetObjectBuffer.mockResolvedValue(Buffer.from('not a zip at all'))
      const res = await buildApp().request('/', post({ workflowId, manifest: validManifest }))
      expect(res.status).toBe(422)
      const body = await json(res)
      expect(body.code).toBe('ARTIFACT_INVALID')
      expect((body.problems as string[])[0]).toContain('not a zip')
      // The workflow row is NOT created on a failed artifact.
      expect(mockRepo.create).not.toHaveBeenCalled()
      expect(mockRepo.attachRuntimeToken).not.toHaveBeenCalled()
    })

    it('returns 422 ARTIFACT_INVALID when an entry point does not resolve in the zip', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: false })
      const res = await buildApp().request(
        '/',
        post({
          workflowId,
          manifest: { ...validManifest, entryPoints: ['workflows.send_quote_followup:X'] },
        }),
      )
      expect(res.status).toBe(422)
      const body = await json(res)
      expect(body.code).toBe('ARTIFACT_INVALID')
      expect((body.problems as string[])[0]).toContain('workflows.send_quote_followup:X')
      expect(mockRepo.create).not.toHaveBeenCalled()
    })

    it('returns 400 VALIDATION_ERROR when the manifest declares dependencies', async () => {
      const res = await buildApp().request(
        '/',
        post({
          workflowId,
          manifest: { ...validManifest, dependencies: ['requests==2.32.0'] },
        }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
      expect(mockHeadObject).not.toHaveBeenCalled()
    })
  })

  // ── GET / ─────────────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns 200 with the union of tenant + GLOBAL workflows', async () => {
      mockRepo.listForTenant.mockResolvedValue([
        mockRow,
        { ...mockRow, id: 'wf-2', visibility: 'GLOBAL' },
      ])
      const res = await buildApp().request('/')
      expect(res.status).toBe(200)
      const body = await json(res)
      const data = body.data as JsonBody[]
      expect(data.length).toBe(2)
      expect(data.every((r) => !('artifactKey' in r))).toBe(true)
      expect((body.meta as JsonBody)['count']).toBe(2)
    })
  })

  // ── GET /:id ──────────────────────────────────────────────────────────────

  describe('GET /:id', () => {
    it('returns 200 with the workflow when visible', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(mockRow)
      const res = await buildApp().request('/wf-1')
      expect(res.status).toBe(200)
      expect(((await json(res)).data as JsonBody)['id']).toBe('wf-1')
    })

    it('returns 404 when not visible to this tenant', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(null)
      const res = await buildApp().request('/wf-1')
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })
  })

  // ── GET /:id/download-url ─────────────────────────────────────────────────

  describe('GET /:id/download-url', () => {
    it('returns 404 when workflow not visible', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(null)
      const res = await buildApp().request('/wf-1/download-url')
      expect(res.status).toBe(404)
    })

    it('returns 200 with presigned downloadUrl', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(mockRow)
      const res = await buildApp().request('/wf-1/download-url')
      expect(res.status).toBe(200)
      const body = (await json(res)).data as JsonBody
      expect(body['downloadUrl']).toBe('https://s3.example/get?sig=xyz')
      expect(body['expiresInSeconds']).toBe(5 * 60)
      expect(mockPresignDownload).toHaveBeenCalledWith(mockRow.artifactKey)
    })

    it('lets a tenant download a GLOBAL workflow it does not own', async () => {
      // The repo handles visibility; if it returns the row, the handler trusts it.
      mockRepo.findByIdForTenant.mockResolvedValue({
        ...mockRow,
        tenantId: 'platform-tenant-id',
        visibility: 'GLOBAL' as const,
      })
      const res = await buildApp().request('/wf-1/download-url')
      expect(res.status).toBe(200)
    })
  })

  // ── POST /:id/fork ────────────────────────────────────────────────────────

  describe('POST /:id/fork', () => {
    it('returns 403 without workflow_developer role', async () => {
      const res = await buildApp(['viewer']).request('/global-wf-1/fork', post({}))
      expect(res.status).toBe(403)
    })

    it('returns 404 when the source is not visible', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(null)
      const res = await buildApp().request('/global-wf-1/fork', post({}))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 404 when the source is visible but not GLOBAL', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(mockRow) // TENANT visibility
      const res = await buildApp().request('/wf-1/fork', post({}))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
      expect(mockRepo.forkGlobalToTenant).not.toHaveBeenCalled()
    })

    it('returns 422 when no authenticated user', async () => {
      const res = await buildApp(['tenant_admin'], null).request('/global-wf-1/fork', post({}))
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('UNAUTHENTICATED')
    })

    it('returns 409 on a natural-key clash (P2002)', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(globalRow)
      mockRepo.forkGlobalToTenant.mockRejectedValue(
        Object.assign(new Error('Unique'), { code: 'P2002' }),
      )
      const res = await buildApp().request('/global-wf-1/fork', post({}))
      expect(res.status).toBe(409)
      expect((await json(res)).code).toBe('CONFLICT')
    })

    it('returns 201 with the new TENANT-visibility row and forked provenance', async () => {
      const forkedRow = {
        ...provisionedRow,
        id: 'forked-wf-1',
        visibility: 'TENANT' as const,
        forkedFromWorkflowId: 'global-wf-1',
        forkedFromVersion: '1.0.0',
      }
      mockRepo.findByIdForTenant.mockResolvedValue(globalRow)
      mockRepo.forkGlobalToTenant.mockResolvedValue(forkedRow)
      // The response is built from attachRuntimeToken's updated-row return.
      mockRepo.attachRuntimeToken.mockResolvedValue(forkedRow)
      const res = await buildApp().request('/global-wf-1/fork', post({}))
      expect(res.status).toBe(201)
      const body = (await json(res)).data as JsonBody
      expect(body['id']).toBe('forked-wf-1')
      expect(body['visibility']).toBe('TENANT')
      expect(body['forkedFromWorkflowId']).toBe('global-wf-1')
      expect(body['forkedFromVersion']).toBe('1.0.0')
      expect(mockRepo.forkGlobalToTenant).toHaveBeenCalledWith(
        globalRow,
        'test-tenant-id',
        'user-1',
      )
      // Fork never re-downloads or re-validates the artifact: the S3 copy is
      // byte-identical, so the integrity fields propagate inside the repo.
      expect(mockHeadObject).not.toHaveBeenCalled()
      expect(mockGetObjectBuffer).not.toHaveBeenCalled()
    })

    it('strips artifactKey from the fork response', async () => {
      const forkedRow = { ...provisionedRow, id: 'forked-wf-1' }
      mockRepo.findByIdForTenant.mockResolvedValue(globalRow)
      mockRepo.forkGlobalToTenant.mockResolvedValue(forkedRow)
      mockRepo.attachRuntimeToken.mockResolvedValue(forkedRow)
      const res = await buildApp().request('/global-wf-1/fork', post({}))
      const body = (await json(res)).data as JsonBody
      expect('artifactKey' in body).toBe(false)
    })

    it('provisions a runtime service account on fork and persists a ciphertext', async () => {
      const forkedRow = { ...provisionedRow, id: 'forked-wf-1' }
      mockRepo.findByIdForTenant.mockResolvedValue(globalRow)
      mockRepo.forkGlobalToTenant.mockResolvedValue(forkedRow)
      mockRepo.attachRuntimeToken.mockResolvedValue(forkedRow)
      const res = await buildApp().request('/global-wf-1/fork', post({}))
      expect(res.status).toBe(201)

      expect(mockTenantUserCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isServiceAccount: true,
            roleNames: ['workflow_runtime'],
          }),
        }),
      )
      expect(mockApiClientRepo.create).toHaveBeenCalledWith(
        'test-tenant-id',
        'wf-runtime-forked-wf-1',
        [],
        'user-1',
        expect.any(String),
      )
      expect(mockEncryptRuntimeToken).toHaveBeenCalledWith('vnd_THIS_IS_THE_PLAINTEXT_KEY')
      expect(mockRepo.attachRuntimeToken).toHaveBeenCalledWith(
        'forked-wf-1',
        { runtimeTokenCiphertext: 'BASE64-CIPHERTEXT', runtimeApiClientId: 'api-client-1' },
        expect.anything(),
      )
    })

    it('never exposes the runtime plaintext key in the fork response', async () => {
      const forkedRow = { ...provisionedRow, id: 'forked-wf-1' }
      mockRepo.findByIdForTenant.mockResolvedValue(globalRow)
      mockRepo.forkGlobalToTenant.mockResolvedValue(forkedRow)
      mockRepo.attachRuntimeToken.mockResolvedValue(forkedRow)
      const res = await buildApp().request('/global-wf-1/fork', post({}))
      const raw = await res.text()
      expect(raw).not.toContain('vnd_THIS_IS_THE_PLAINTEXT_KEY')
      expect(raw).not.toContain('BASE64-CIPHERTEXT')
    })
  })

  // ── POST /:id/run ─────────────────────────────────────────────────────────

  describe('POST /:id/run', () => {
    const execId = 'exec-1'
    const queuedExecution = {
      id: execId,
      tenantId: 'test-tenant-id',
      workflowId: 'wf-1',
      status: 'QUEUED' as const,
      input: { quote_id: 'q-1' },
      result: null,
      errorMessage: null,
      temporalWorkflowId: null,
      temporalRunId: null,
      triggeredByUserId: 'user-1',
      triggerSource: 'USER' as const,
      triggeredByTriggerId: null,
      queuedAt: now,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    const runningExecution = {
      ...queuedExecution,
      status: 'RUNNING' as const,
      startedAt: now,
      temporalWorkflowId: 'wf/test-tenant-id/send_quote_followup/exec-1',
      temporalRunId: 'run-123',
    }

    beforeEach(() => {
      mockExecutionRepo.create.mockResolvedValue(queuedExecution)
      mockExecutionRepo.markStarted.mockResolvedValue(runningExecution)
      mockExecutionRepo.markTerminal.mockResolvedValue({
        ...queuedExecution,
        status: 'FAILED',
        errorMessage: 'Temporal start_workflow failed: boom',
        finishedAt: now,
      })
      mockTemporalStart.mockResolvedValue({
        workflowId: 'wf/test-tenant-id/send_quote_followup/exec-1',
        firstExecutionRunId: 'run-123',
      })
    })

    it('returns 403 without workflow_developer or tenant_admin', async () => {
      const res = await buildApp(['viewer']).request('/wf-1/run', post({ input: {} }))
      expect(res.status).toBe(403)
    })

    it('returns 404 when the workflow is not visible to the tenant', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(null)
      const res = await buildApp().request('/wf-1/run', post({ input: {} }))
      expect(res.status).toBe(404)
    })

    it('returns 400 WORKFLOW_NOT_EXECUTABLE when executable=false and non-curated name', async () => {
      // Pre-Track-A tenant workflow: not yet executable → route = NOT_EXECUTABLE.
      // A non-curated name with executable=true would instead route to TENANT_RUNNER.
      mockRepo.findByIdForTenant.mockResolvedValue({
        ...provisionedRow,
        name: 'some_other_workflow',
        executable: false,
      })
      const res = await buildApp().request('/wf-1/run', post({ input: {} }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('WORKFLOW_NOT_EXECUTABLE')
    })

    it('starts the workflow and returns the RUNNING row on the happy path', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      const res = await buildApp().request('/wf-1/run', post({ input: { quote_id: 'q-1' } }))
      expect(res.status).toBe(201)
      const data = (await json(res)).data as JsonBody
      expect(data['id']).toBe(execId)
      expect(data['status']).toBe('RUNNING')
      // The runtime token MUST NOT appear in workflow args.
      const startArgs = mockTemporalStart.mock.calls[0]?.[1]?.['args'] as unknown[] | undefined
      expect(startArgs).toBeDefined()
      expect(JSON.stringify(startArgs)).not.toContain('vnd_')
      expect(JSON.stringify(startArgs)).toContain(execId)
      // Workflow id matches the contract.
      expect(mockTemporalStart.mock.calls[0]?.[1]?.['workflowId']).toBe(
        'wf/test-tenant-id/send_quote_followup/exec-1',
      )
      // REJECT_DUPLICATE policy.
      expect(mockTemporalStart.mock.calls[0]?.[1]?.['workflowIdReusePolicy']).toBe(
        'REJECT_DUPLICATE',
      )
    })

    it('422 DRY_RUN_UNSUPPORTED — dry-run of a curated (STDLIB) workflow is rejected', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      const res = await buildApp().request('/wf-1/run', post({ input: {}, mode: 'dry_run' }))
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('DRY_RUN_UNSUPPORTED')
      // Nothing started on Temporal.
      expect(mockTemporalStart).not.toHaveBeenCalled()
    })

    it('400 VALIDATION_ERROR — unknown mode', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      const res = await buildApp().request('/wf-1/run', post({ input: {}, mode: 'nope' }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('lazy-mints the runtime account when the workflow lacks one', async () => {
      // mockRow.runtimeApiClientId / runtimeTokenCiphertext are both null.
      mockRepo.findByIdForTenant.mockResolvedValue(mockRow)
      const res = await buildApp().request('/wf-1/run', post({ input: {} }))
      expect(res.status).toBe(201)
      expect(mockTenantUserCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isServiceAccount: true,
            roleNames: ['workflow_runtime'],
          }),
        }),
      )
      expect(mockApiClientRepo.create).toHaveBeenCalled()
      expect(mockEncryptRuntimeToken).toHaveBeenCalled()
    })

    it('does NOT re-mint when the workflow already has a runtime account', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      await buildApp().request('/wf-1/run', post({ input: {} }))
      expect(mockTenantUserCreate).not.toHaveBeenCalled()
      expect(mockApiClientRepo.create).not.toHaveBeenCalled()
    })

    it('rolls the execution to FAILED + returns 502 when Temporal start throws', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockTemporalStart.mockRejectedValue(new Error('boom'))
      const res = await buildApp().request('/wf-1/run', post({ input: {} }))
      expect(res.status).toBe(502)
      expect(mockExecutionRepo.markTerminal).toHaveBeenCalledWith(
        execId,
        expect.objectContaining({ status: 'FAILED' }),
      )
    })

    it('returns 422 when no authenticated user', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      const res = await buildApp(['tenant_admin'], null).request('/wf-1/run', post({ input: {} }))
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('UNAUTHENTICATED')
    })

    it('returns 423 WORKFLOWS_DISABLED with code when operator kill switch is on', async () => {
      // Kill switch ON for this tenant.
      mockTenantFindUnique.mockResolvedValue({ workflowsDisabled: true })
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      const res = await buildApp().request('/wf-1/run', post({ input: {} }))
      expect(res.status).toBe(423)
      const body = await json(res)
      expect(body['code']).toBe('WORKFLOWS_DISABLED')
      // No execution row should be created.
      expect(mockExecutionRepo.create).not.toHaveBeenCalled()
    })

    it('returns 403 WORKFLOW_MUST_FORK when a non-owning tenant tries to run a non-curated GLOBAL workflow', async () => {
      // The caller is 'test-tenant-id' (injected by buildApp's dualAuthMiddleware stub).
      // The workflow is owned by 'platform-tenant-id' and has visibility=GLOBAL.
      // A non-curated name (not in CURATED_WORKFLOW_NAMES) routes TENANT_RUNNER,
      // hitting the cross-tenant guard before any DB write.
      mockTenantFindUnique.mockResolvedValue({ workflowsDisabled: false })
      mockRepo.findByIdForTenant.mockResolvedValue({
        ...provisionedRow,
        id: 'global-platform-wf',
        tenantId: 'platform-tenant-id', // owned by a different tenant
        name: 'custom_platform_tool', // not curated → routes TENANT_RUNNER
        visibility: 'GLOBAL' as const,
      })
      const res = await buildApp().request('/global-platform-wf/run', post({ input: {} }))
      expect(res.status).toBe(403)
      const body = await json(res)
      expect(body['code']).toBe('WORKFLOW_MUST_FORK')
      // No execution row should be created, no Temporal start.
      expect(mockExecutionRepo.create).not.toHaveBeenCalled()
      expect(mockTemporalStart).not.toHaveBeenCalled()
    })
  })

  // ── GET /:id/executions ───────────────────────────────────────────────────

  describe('GET /:id/executions', () => {
    const execRow = {
      id: 'exec-1',
      tenantId: 'test-tenant-id',
      workflowId: 'wf-1',
      workflow: { name: 'send_quote_followup', version: '0.1.0' },
      status: 'COMPLETED' as const,
      input: {},
      result: { message: 'ok' },
      errorMessage: null,
      temporalWorkflowId: 'wf/test-tenant-id/send_quote_followup/exec-1',
      temporalRunId: 'run-123',
      triggeredByUserId: 'user-1',
      triggerSource: 'USER' as const,
      triggeredByTriggerId: null,
      queuedAt: now,
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    }

    it('returns 404 when the workflow is not visible', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(null)
      const res = await buildApp().request('/wf-1/executions')
      expect(res.status).toBe(404)
    })

    it('returns the executions list newest-first', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockExecutionRepo.listByWorkflow.mockResolvedValue([execRow])
      const res = await buildApp().request('/wf-1/executions')
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body['data'] as unknown[]).length).toBe(1)
      expect((body['meta'] as JsonBody)['count']).toBe(1)
    })

    it('reports the name + version of the build the execution runs', async () => {
      // sdk-feedback 0034: the tenant runner installs the artifact for THIS
      // execution's workflowId and fails rather than substituting another, so
      // the joined version is the executed one — readable without a second
      // GET /workflows/:id.
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockExecutionRepo.listByWorkflow.mockResolvedValue([execRow])
      const res = await buildApp().request('/wf-1/executions')
      const row = ((await json(res))['data'] as JsonBody[])[0]!
      expect(row['workflowName']).toBe('send_quote_followup')
      expect(row['workflowVersion']).toBe('0.1.0')
    })

    it('returns 400 on a negative limit', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      const res = await buildApp().request('/wf-1/executions?limit=-3')
      expect(res.status).toBe(400)
    })

    it('forwards the before cursor to the repo', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockExecutionRepo.listByWorkflow.mockResolvedValue([])
      await buildApp().request('/wf-1/executions?limit=10&before=exec-prev')
      expect(mockExecutionRepo.listByWorkflow).toHaveBeenCalledWith('wf-1', {
        limit: 10,
        before: 'exec-prev',
      })
    })
  })

  // ── GET /:id/executions/:executionId ──────────────────────────────────────

  describe('GET /:id/executions/:executionId', () => {
    const execRow = {
      id: 'exec-1',
      tenantId: 'test-tenant-id',
      workflowId: 'wf-1',
      status: 'COMPLETED' as const,
      input: {},
      result: { message: 'ok' },
      errorMessage: null,
      temporalWorkflowId: null,
      temporalRunId: null,
      triggeredByUserId: 'user-1',
      triggerSource: 'USER' as const,
      triggeredByTriggerId: null,
      queuedAt: now,
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    }

    it('returns 404 when the workflow is not visible', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(null)
      const res = await buildApp().request('/wf-1/executions/exec-1')
      expect(res.status).toBe(404)
    })

    it('returns 404 when the execution belongs to another workflow', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockExecutionRepo.findById.mockResolvedValue({
        ...execRow,
        workflowId: 'wf-other',
      })
      const res = await buildApp().request('/wf-1/executions/exec-1')
      expect(res.status).toBe(404)
    })

    it('returns the execution row when scoping is satisfied', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockExecutionRepo.findById.mockResolvedValue(execRow)
      const res = await buildApp().request('/wf-1/executions/exec-1')
      expect(res.status).toBe(200)
      const data = (await json(res)).data as JsonBody
      expect(data['id']).toBe('exec-1')
    })
  })

  // ── GET /:id/executions/:executionId/history ──────────────────────────────

  describe('GET /:id/executions/:executionId/history', () => {
    const runningExec = {
      id: 'exec-1',
      tenantId: 'test-tenant-id',
      workflowId: 'wf-1',
      status: 'RUNNING' as const,
      input: {},
      result: null,
      errorMessage: null,
      temporalWorkflowId: 'wf/test-tenant-id/send_quote_followup/exec-1',
      temporalRunId: 'run-1',
      triggeredByUserId: 'user-1',
      triggerSource: 'USER' as const,
      triggeredByTriggerId: null,
      queuedAt: now,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    }

    // A minimal Temporal History proto: started → activity scheduled →
    // activity failed (carrying the failure + correlated activity name).
    const fakeHistory = {
      events: [
        {
          eventId: 1,
          eventTime: { seconds: 1_700_000_000, nanos: 0 },
          workflowExecutionStartedEventAttributes: {},
        },
        {
          eventId: 5,
          eventTime: { seconds: 1_700_000_001, nanos: 0 },
          activityTaskScheduledEventAttributes: { activityType: { name: 'compose_followup' } },
        },
        {
          eventId: 7,
          eventTime: { seconds: 1_700_000_002, nanos: 0 },
          activityTaskFailedEventAttributes: {
            scheduledEventId: 5,
            failure: { message: 'boom 401' },
          },
        },
      ],
    }

    it('returns 404 when the workflow is not visible', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(null)
      const res = await buildApp().request('/wf-1/executions/exec-1/history')
      expect(res.status).toBe(404)
    })

    it('returns an empty timeline when the run never started on Temporal', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockExecutionRepo.findById.mockResolvedValue({ ...runningExec, temporalWorkflowId: null })
      const res = await buildApp().request('/wf-1/executions/exec-1/history')
      expect(res.status).toBe(200)
      const data = (await json(res)).data as { events: unknown[] }
      expect(data.events).toEqual([])
      expect(mockGetHandle).not.toHaveBeenCalled()
    })

    it('flattens the Temporal history into a timeline', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockExecutionRepo.findById.mockResolvedValue(runningExec)
      mockHandleFetchHistory.mockResolvedValue(fakeHistory)
      const res = await buildApp().request('/wf-1/executions/exec-1/history')
      expect(res.status).toBe(200)
      expect(mockGetHandle).toHaveBeenCalledWith(
        'wf/test-tenant-id/send_quote_followup/exec-1',
        'run-1',
      )
      const events = ((await json(res)).data as { events: Array<Record<string, unknown>> }).events
      expect(events.map((e) => e['type'])).toEqual([
        'WorkflowExecutionStarted',
        'ActivityTaskScheduled',
        'ActivityTaskFailed',
      ])
      // Activity name correlated from the scheduled event onto the failed one.
      expect(events[2]).toMatchObject({ activityType: 'compose_followup', failure: 'boom 401' })
    })

    it('returns 404 when Temporal no longer has the history', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockExecutionRepo.findById.mockResolvedValue(runningExec)
      const notFound = new Error('not found')
      notFound.name = 'WorkflowNotFoundError'
      mockHandleFetchHistory.mockRejectedValue(notFound)
      const res = await buildApp().request('/wf-1/executions/exec-1/history')
      expect(res.status).toBe(404)
    })

    it('returns 502 on an unexpected Temporal error', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockExecutionRepo.findById.mockResolvedValue(runningExec)
      mockHandleFetchHistory.mockRejectedValue(new Error('grpc unavailable'))
      const res = await buildApp().request('/wf-1/executions/exec-1/history')
      expect(res.status).toBe(502)
      expect((await json(res)).code).toBe('TEMPORAL_HISTORY_UNAVAILABLE')
    })
  })

  // ── POST /:id/executions/:executionId/cancel ──────────────────────────────

  describe('POST /:id/executions/:executionId/cancel', () => {
    const runningExec = {
      id: 'exec-1',
      tenantId: 'test-tenant-id',
      workflowId: 'wf-1',
      status: 'RUNNING' as const,
      input: {},
      result: null,
      errorMessage: null,
      temporalWorkflowId: 'wf/test-tenant-id/send_quote_followup/exec-1',
      temporalRunId: 'run-1',
      triggeredByUserId: 'user-1',
      triggerSource: 'USER' as const,
      triggeredByTriggerId: null,
      queuedAt: now,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    }

    it('returns 403 without the cancel permission', async () => {
      const res = await buildApp(['viewer']).request('/wf-1/executions/exec-1/cancel', post({}))
      expect(res.status).toBe(403)
    })

    it('requests cancellation and returns 202 with the still-RUNNING row', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockExecutionRepo.findById.mockResolvedValue(runningExec)
      mockHandleCancel.mockResolvedValue(undefined)
      const res = await buildApp().request('/wf-1/executions/exec-1/cancel', post({}))
      expect(res.status).toBe(202)
      expect(mockHandleCancel).toHaveBeenCalledTimes(1)
      const data = (await json(res)).data as JsonBody
      expect(data['status']).toBe('RUNNING')
    })

    it('returns 409 when the execution is already terminal', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockExecutionRepo.findById.mockResolvedValue({ ...runningExec, status: 'COMPLETED' })
      const res = await buildApp().request('/wf-1/executions/exec-1/cancel', post({}))
      expect(res.status).toBe(409)
      expect(mockHandleCancel).not.toHaveBeenCalled()
    })

    it('returns 409 when the execution has no Temporal id yet', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockExecutionRepo.findById.mockResolvedValue({
        ...runningExec,
        status: 'QUEUED',
        temporalWorkflowId: null,
      })
      const res = await buildApp().request('/wf-1/executions/exec-1/cancel', post({}))
      expect(res.status).toBe(409)
    })

    it('returns 502 when Temporal cancel fails', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockExecutionRepo.findById.mockResolvedValue(runningExec)
      mockHandleCancel.mockRejectedValue(new Error('grpc down'))
      const res = await buildApp().request('/wf-1/executions/exec-1/cancel', post({}))
      expect(res.status).toBe(502)
      expect((await json(res)).code).toBe('TEMPORAL_CANCEL_FAILED')
    })
  })

  // ── POST /:id/executions/:executionId/retry ───────────────────────────────

  describe('POST /:id/executions/:executionId/retry', () => {
    const failedExec = {
      id: 'exec-1',
      tenantId: 'test-tenant-id',
      workflowId: 'wf-1',
      status: 'FAILED' as const,
      input: { quoteId: 'q-9' },
      result: null,
      errorMessage: 'boom',
      temporalWorkflowId: 'wf/test-tenant-id/send_quote_followup/exec-1',
      temporalRunId: 'run-1',
      triggeredByUserId: 'user-1',
      triggerSource: 'USER' as const,
      triggeredByTriggerId: null,
      queuedAt: now,
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    }

    it('returns 403 without the retry permission', async () => {
      const res = await buildApp(['viewer']).request('/wf-1/executions/exec-1/retry', post({}))
      expect(res.status).toBe(403)
    })

    it('starts a new execution with the original input and returns 201', async () => {
      mockTenantFindUnique.mockResolvedValue({
        isPlatformTenant: false,
        workflowsDisabled: false,
      })
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockExecutionRepo.findById.mockResolvedValue(failedExec)
      mockExecutionRepo.create.mockResolvedValue({ ...failedExec, id: 'exec-2', status: 'QUEUED' })
      mockExecutionRepo.markStarted.mockResolvedValue({
        ...failedExec,
        id: 'exec-2',
        status: 'RUNNING',
      })
      mockTemporalStart.mockResolvedValue({ workflowId: 'wf-x', firstExecutionRunId: 'run-2' })
      const res = await buildApp().request('/wf-1/executions/exec-1/retry', post({}))
      expect(res.status).toBe(201)
      // A NEW execution was inserted carrying the original input.
      expect(mockExecutionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ input: { quoteId: 'q-9' } }),
      )
      const data = (await json(res)).data as JsonBody
      expect(data['id']).toBe('exec-2')
    })

    it('returns 409 when the execution is not in a retryable state', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockExecutionRepo.findById.mockResolvedValue({ ...failedExec, status: 'COMPLETED' })
      const res = await buildApp().request('/wf-1/executions/exec-1/retry', post({}))
      expect(res.status).toBe(409)
      expect((await json(res)).code).toBe('EXECUTION_NOT_RETRYABLE')
      expect(mockExecutionRepo.create).not.toHaveBeenCalled()
    })
  })

  // ── POST /:id/triggers ────────────────────────────────────────────────────

  describe('POST /:id/triggers', () => {
    const eventTriggerRow = {
      id: 'trig-1',
      tenantId: 'test-tenant-id',
      workflowId: 'wf-1',
      kind: 'EVENT' as const,
      eventType: 'quote.accepted',
      filter: null,
      cronExpression: null,
      enabled: true,
      createdByUserId: 'user-1',
      createdAt: now,
      updatedAt: now,
    }
    const scheduleTriggerRow = {
      ...eventTriggerRow,
      id: 'trig-2',
      kind: 'SCHEDULE' as const,
      eventType: null,
      cronExpression: '0 9 * * 1',
    }

    it('returns 403 without ManageWorkflowTriggers (viewer)', async () => {
      const res = await buildApp(['viewer']).request(
        '/wf-1/triggers',
        post({ kind: 'EVENT', eventType: 'quote.accepted' }),
      )
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })

    it('allows workflow_developer to create a trigger', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockTriggerRepo.create.mockResolvedValue(eventTriggerRow)
      const res = await buildApp(['workflow_developer']).request(
        '/wf-1/triggers',
        post({ kind: 'EVENT', eventType: 'quote.accepted' }),
      )
      expect(res.status).toBe(201)
    })

    it('creates an EVENT trigger on the happy path (201, defaults enabled)', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockTriggerRepo.create.mockResolvedValue(eventTriggerRow)
      const res = await buildApp().request(
        '/wf-1/triggers',
        post({ kind: 'EVENT', eventType: 'quote.accepted', filter: { quoteId: 'q-1' } }),
      )
      expect(res.status).toBe(201)
      const data = (await json(res)).data as JsonBody
      expect(data['id']).toBe('trig-1')
      expect(data['kind']).toBe('EVENT')
      expect(mockTriggerRepo.create).toHaveBeenCalledWith({
        tenantId: 'test-tenant-id',
        workflowId: 'wf-1',
        kind: 'EVENT',
        eventType: 'quote.accepted',
        filter: { quoteId: 'q-1' },
        cronExpression: null,
        enabled: true,
        createdByUserId: 'user-1',
      })
    })

    it('creates a SCHEDULE trigger on the happy path (201)', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockTriggerRepo.create.mockResolvedValue(scheduleTriggerRow)
      const res = await buildApp().request(
        '/wf-1/triggers',
        post({ kind: 'SCHEDULE', cronExpression: '0 9 * * 1', enabled: false }),
      )
      expect(res.status).toBe(201)
      expect(mockTriggerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'SCHEDULE', cronExpression: '0 9 * * 1', enabled: false }),
      )
    })

    it('rejects an eventType that is neither built-in nor a registered custom type', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockEventTypeRepo.findByName.mockResolvedValue(null) // not in the registry
      const res = await buildApp().request(
        '/wf-1/triggers',
        post({ kind: 'EVENT', eventType: 'not.a.real.event' }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('accepts an EVENT trigger on a registered custom event type (201)', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockEventTypeRepo.findByName.mockResolvedValue({ name: 'lead.qualified', enabled: true })
      mockTriggerRepo.create.mockResolvedValue(eventTriggerRow)
      const res = await buildApp().request(
        '/wf-1/triggers',
        post({ kind: 'EVENT', eventType: 'lead.qualified' }),
      )
      expect(res.status).toBe(201)
      expect(mockEventTypeRepo.findByName).toHaveBeenCalledWith('lead.qualified')
    })

    it('accepts a built-in pegII integration event type without a registry lookup (201)', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockTriggerRepo.create.mockResolvedValue(eventTriggerRow)
      const res = await buildApp().request(
        '/wf-1/triggers',
        post({ kind: 'EVENT', eventType: 'pegii.shipment.opened' }),
      )
      expect(res.status).toBe(201)
      // Integration types are globally built-in — no per-tenant registry lookup.
      expect(mockEventTypeRepo.findByName).not.toHaveBeenCalled()
    })

    it('rejects a registered-but-DISABLED custom event type (400)', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockEventTypeRepo.findByName.mockResolvedValue({ name: 'lead.qualified', enabled: false })
      const res = await buildApp().request(
        '/wf-1/triggers',
        post({ kind: 'EVENT', eventType: 'lead.qualified' }),
      )
      expect(res.status).toBe(400)
    })

    it('accepts a v2 structured filter (operators + combinators)', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockTriggerRepo.create.mockResolvedValue(eventTriggerRow)
      const res = await buildApp().request(
        '/wf-1/triggers',
        post({
          kind: 'EVENT',
          eventType: 'move.status_changed',
          filter: { all: [{ path: 'newStatus', op: 'eq', value: 'COMPLETED' }] },
        }),
      )
      expect(res.status).toBe(201)
    })

    it('rejects a structurally invalid filter (400)', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      const res = await buildApp().request(
        '/wf-1/triggers',
        post({ kind: 'EVENT', eventType: 'quote.accepted', filter: { op: 'bogus', path: 'x' } }),
      )
      expect(res.status).toBe(400)
    })

    it('rejects an EVENT trigger that carries a cronExpression', async () => {
      const res = await buildApp().request(
        '/wf-1/triggers',
        post({ kind: 'EVENT', eventType: 'quote.accepted', cronExpression: '0 9 * * 1' }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('rejects a SCHEDULE trigger without a cronExpression', async () => {
      const res = await buildApp().request('/wf-1/triggers', post({ kind: 'SCHEDULE' }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('rejects a SCHEDULE trigger that carries an eventType', async () => {
      const res = await buildApp().request(
        '/wf-1/triggers',
        post({ kind: 'SCHEDULE', cronExpression: '0 9 * * 1', eventType: 'quote.accepted' }),
      )
      expect(res.status).toBe(400)
    })

    it('rejects a malformed cron expression (4 fields)', async () => {
      const res = await buildApp().request(
        '/wf-1/triggers',
        post({ kind: 'SCHEDULE', cronExpression: '0 9 * *' }),
      )
      expect(res.status).toBe(400)
    })

    it('rejects a cron expression with illegal characters', async () => {
      const res = await buildApp().request(
        '/wf-1/triggers',
        post({ kind: 'SCHEDULE', cronExpression: '0 9 * * 1; DROP TABLE' }),
      )
      expect(res.status).toBe(400)
    })

    // Unit 4: validation is the dispatcher's real parser (lib/cron.ts), not
    // the Unit-2 charset regex — semantically invalid expressions that the
    // regex admitted are now 400s at create time.
    it('rejects a semantically invalid cron expression (out-of-range minute)', async () => {
      const res = await buildApp().request(
        '/wf-1/triggers',
        post({ kind: 'SCHEDULE', cronExpression: '61 * * * *' }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('rejects 7-as-Sunday (v1 dialect uses 0-6 only)', async () => {
      const res = await buildApp().request(
        '/wf-1/triggers',
        post({ kind: 'SCHEDULE', cronExpression: '0 9 * * 7' }),
      )
      expect(res.status).toBe(400)
    })

    it('accepts a full-dialect cron expression (lists, ranges, steps)', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockTriggerRepo.create.mockResolvedValue(scheduleTriggerRow)
      const res = await buildApp().request(
        '/wf-1/triggers',
        post({ kind: 'SCHEDULE', cronExpression: '*/15 9-17 1,15 * 1-5' }),
      )
      expect(res.status).toBe(201)
    })

    it('rejects a filter that is an array', async () => {
      const res = await buildApp().request(
        '/wf-1/triggers',
        post({ kind: 'EVENT', eventType: 'quote.accepted', filter: ['not', 'an', 'object'] }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('allows attaching a trigger to a visible GLOBAL workflow (row owned by caller tenant)', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(globalRow)
      mockTriggerRepo.create.mockResolvedValue({ ...eventTriggerRow, workflowId: 'global-wf-1' })
      const res = await buildApp().request(
        '/global-wf-1/triggers',
        post({ kind: 'EVENT', eventType: 'quote.accepted' }),
      )
      expect(res.status).toBe(201)
      // The trigger belongs to the CALLER's tenant, not the platform tenant.
      expect(mockTriggerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'test-tenant-id', workflowId: 'global-wf-1' }),
      )
    })

    it("returns 404 for another tenant's TENANT workflow (not visible)", async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(null)
      const res = await buildApp().request(
        '/other-wf/triggers',
        post({ kind: 'EVENT', eventType: 'quote.accepted' }),
      )
      expect(res.status).toBe(404)
      expect(mockTriggerRepo.create).not.toHaveBeenCalled()
    })

    it('returns 422 when no authenticated user', async () => {
      const res = await buildApp(['tenant_admin'], null).request(
        '/wf-1/triggers',
        post({ kind: 'EVENT', eventType: 'quote.accepted' }),
      )
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('UNAUTHENTICATED')
    })
  })

  // ── GET /:id/triggers ─────────────────────────────────────────────────────

  describe('GET /:id/triggers', () => {
    const triggerRow = {
      id: 'trig-1',
      tenantId: 'test-tenant-id',
      workflowId: 'wf-1',
      kind: 'EVENT' as const,
      eventType: 'quote.accepted',
      filter: null,
      cronExpression: null,
      enabled: true,
      createdByUserId: 'user-1',
      createdAt: now,
      updatedAt: now,
    }

    it('returns 404 when the workflow is not visible', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(null)
      const res = await buildApp().request('/wf-1/triggers')
      expect(res.status).toBe(404)
    })

    it('returns the tenant-scoped trigger list (read-level gate: viewer allowed)', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
      mockTriggerRepo.listByWorkflow.mockResolvedValue([triggerRow])
      const res = await buildApp(['viewer']).request('/wf-1/triggers')
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body['data'] as unknown[]).length).toBe(1)
      expect((body['meta'] as JsonBody)['count']).toBe(1)
      expect(mockTriggerRepo.listByWorkflow).toHaveBeenCalledWith('wf-1')
    })
  })

  // ── PATCH /:id/triggers/:triggerId ────────────────────────────────────────

  describe('PATCH /:id/triggers/:triggerId', () => {
    const eventTriggerRow = {
      id: 'trig-1',
      tenantId: 'test-tenant-id',
      workflowId: 'wf-1',
      kind: 'EVENT' as const,
      eventType: 'quote.accepted',
      filter: null,
      cronExpression: null,
      enabled: true,
      createdByUserId: 'user-1',
      createdAt: now,
      updatedAt: now,
    }
    const scheduleTriggerRow = {
      ...eventTriggerRow,
      id: 'trig-2',
      kind: 'SCHEDULE' as const,
      eventType: null,
      cronExpression: '0 9 * * 1',
    }

    beforeEach(() => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
    })

    it('returns 403 without ManageWorkflowTriggers', async () => {
      const res = await buildApp(['viewer']).request(
        '/wf-1/triggers/trig-1',
        patch({ enabled: false }),
      )
      expect(res.status).toBe(403)
    })

    it('updates enabled on the happy path', async () => {
      mockTriggerRepo.findById.mockResolvedValue(eventTriggerRow)
      mockTriggerRepo.update.mockResolvedValue({ ...eventTriggerRow, enabled: false })
      const res = await buildApp().request('/wf-1/triggers/trig-1', patch({ enabled: false }))
      expect(res.status).toBe(200)
      const data = (await json(res)).data as JsonBody
      expect(data['enabled']).toBe(false)
      expect(mockTriggerRepo.update).toHaveBeenCalledWith(
        'trig-1',
        expect.objectContaining({ enabled: false }),
      )
    })

    it("returns 404 when the trigger is not the caller-tenant's (scoped findById → null)", async () => {
      mockTriggerRepo.findById.mockResolvedValue(null)
      const res = await buildApp().request('/wf-1/triggers/trig-x', patch({ enabled: false }))
      expect(res.status).toBe(404)
      expect(mockTriggerRepo.update).not.toHaveBeenCalled()
    })

    it('returns 404 when the trigger belongs to a different workflow', async () => {
      mockTriggerRepo.findById.mockResolvedValue({ ...eventTriggerRow, workflowId: 'wf-other' })
      const res = await buildApp().request('/wf-1/triggers/trig-1', patch({ enabled: false }))
      expect(res.status).toBe(404)
      expect(mockTriggerRepo.update).not.toHaveBeenCalled()
    })

    it('rejects cronExpression on an EVENT trigger', async () => {
      mockTriggerRepo.findById.mockResolvedValue(eventTriggerRow)
      const res = await buildApp().request(
        '/wf-1/triggers/trig-1',
        patch({ cronExpression: '0 9 * * 1' }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('rejects eventType / filter on a SCHEDULE trigger', async () => {
      mockTriggerRepo.findById.mockResolvedValue(scheduleTriggerRow)
      const res = await buildApp().request(
        '/wf-1/triggers/trig-2',
        patch({ eventType: 'quote.accepted' }),
      )
      expect(res.status).toBe(400)
    })

    it('rejects an unknown eventType on an EVENT trigger', async () => {
      mockTriggerRepo.findById.mockResolvedValue(eventTriggerRow)
      const res = await buildApp().request(
        '/wf-1/triggers/trig-1',
        patch({ eventType: 'nope.nope' }),
      )
      expect(res.status).toBe(400)
    })

    it('rejects a malformed cronExpression on a SCHEDULE trigger', async () => {
      mockTriggerRepo.findById.mockResolvedValue(scheduleTriggerRow)
      const res = await buildApp().request(
        '/wf-1/triggers/trig-2',
        patch({ cronExpression: 'not cron' }),
      )
      expect(res.status).toBe(400)
    })

    it('rejects a semantically invalid cronExpression on PATCH (parser-backed, Unit 4)', async () => {
      mockTriggerRepo.findById.mockResolvedValue(scheduleTriggerRow)
      const res = await buildApp().request(
        '/wf-1/triggers/trig-2',
        patch({ cronExpression: '61 * * * *' }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
      expect(mockTriggerRepo.update).not.toHaveBeenCalled()
    })

    it('rejects a kind change (strict body)', async () => {
      mockTriggerRepo.findById.mockResolvedValue(eventTriggerRow)
      const res = await buildApp().request('/wf-1/triggers/trig-1', patch({ kind: 'SCHEDULE' }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
      expect(mockTriggerRepo.update).not.toHaveBeenCalled()
    })

    it('updates filter on an EVENT trigger', async () => {
      mockTriggerRepo.findById.mockResolvedValue(eventTriggerRow)
      mockTriggerRepo.update.mockResolvedValue({
        ...eventTriggerRow,
        filter: { status: 'ACCEPTED' },
      })
      const res = await buildApp().request(
        '/wf-1/triggers/trig-1',
        patch({ filter: { status: 'ACCEPTED' } }),
      )
      expect(res.status).toBe(200)
      expect(mockTriggerRepo.update).toHaveBeenCalledWith(
        'trig-1',
        expect.objectContaining({ filter: { status: 'ACCEPTED' } }),
      )
    })

    it('rejects a filter that is an array on an EVENT trigger', async () => {
      mockTriggerRepo.findById.mockResolvedValue(eventTriggerRow)
      const res = await buildApp().request('/wf-1/triggers/trig-1', patch({ filter: [1, 2] }))
      expect(res.status).toBe(400)
    })
  })

  // ── DELETE /:id/triggers/:triggerId ───────────────────────────────────────

  describe('DELETE /:id/triggers/:triggerId', () => {
    const triggerRow = {
      id: 'trig-1',
      tenantId: 'test-tenant-id',
      workflowId: 'wf-1',
      kind: 'EVENT' as const,
      eventType: 'quote.accepted',
      filter: null,
      cronExpression: null,
      enabled: true,
      createdByUserId: 'user-1',
      createdAt: now,
      updatedAt: now,
    }

    beforeEach(() => {
      mockRepo.findByIdForTenant.mockResolvedValue(provisionedRow)
    })

    it('returns 403 without ManageWorkflowTriggers', async () => {
      const res = await buildApp(['viewer']).request('/wf-1/triggers/trig-1', del())
      expect(res.status).toBe(403)
    })

    it('hard-deletes and returns 204', async () => {
      mockTriggerRepo.findById.mockResolvedValue(triggerRow)
      mockTriggerRepo.deleteById.mockResolvedValue(undefined)
      const res = await buildApp().request('/wf-1/triggers/trig-1', del())
      expect(res.status).toBe(204)
      expect(mockTriggerRepo.deleteById).toHaveBeenCalledWith('trig-1')
    })

    it("returns 404 when the trigger is not the caller-tenant's", async () => {
      mockTriggerRepo.findById.mockResolvedValue(null)
      const res = await buildApp().request('/wf-1/triggers/trig-1', del())
      expect(res.status).toBe(404)
      expect(mockTriggerRepo.deleteById).not.toHaveBeenCalled()
    })

    it('returns 404 when the trigger belongs to a different workflow', async () => {
      mockTriggerRepo.findById.mockResolvedValue({ ...triggerRow, workflowId: 'wf-other' })
      const res = await buildApp().request('/wf-1/triggers/trig-1', del())
      expect(res.status).toBe(404)
      expect(mockTriggerRepo.deleteById).not.toHaveBeenCalled()
    })

    it('returns 404 when the workflow is not visible', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(null)
      const res = await buildApp().request('/wf-1/triggers/trig-1', del())
      expect(res.status).toBe(404)
    })
  })
})
