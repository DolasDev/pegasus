// ---------------------------------------------------------------------------
// Unit tests for the workflow-secrets-configs handler.
//
// The repository and the KMS crypto helpers are mocked so no DB / AWS is
// required. dualAuthMiddleware is stubbed to inject the AppEnv context;
// requirePermission is NOT mocked — real Cedar RBAC runs. The policy split is
// the heart of the feature, so it is asserted directly via the personas:
//   - workflow_developer holds Manage* but NOT Read*  → can write, can't /runtime
//   - workflow_runtime    holds Read*  but NOT Manage* → can /runtime, can't write
//   - tenant_admin is permit-all (management happy paths run under it)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { _clearAuthzCache } from '../lib/authz'

const { mockRepo, mockEncrypt, mockDecrypt } = vi.hoisted(() => ({
  mockRepo: {
    create: vi.fn(),
    findByKey: vi.fn(),
    listByKind: vi.fn(),
    update: vi.fn(),
    deleteByKey: vi.fn(),
  },
  mockEncrypt: vi.fn(),
  mockDecrypt: vi.fn(),
}))

vi.mock('../repositories/workflow-secret-config.repository', () => ({
  createWorkflowSecretConfigRepository: vi.fn(() => mockRepo),
}))

vi.mock('../lib/secret-value-crypto', () => ({
  encryptSecretValue: mockEncrypt,
  decryptSecretValue: mockDecrypt,
}))

vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

import { workflowSecretsConfigsHandler } from './workflow-secrets-configs'
import { dualAuthMiddleware } from '../middleware/dual-auth'

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
const put = (body: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

function buildApp(
  roleNames: readonly string[] = ['tenant_admin'],
  userId: string | null = 'user-1',
) {
  const fakeDb = {} as unknown as PrismaClient
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
  app.route('/workflow-secrets-configs', workflowSecretsConfigsHandler)
  return app
}

const now = new Date('2026-06-27T12:00:00Z')
function secretRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 's-1',
    tenantId: 'test-tenant-id',
    kind: 'SECRET',
    key: 'DB_PASSWORD',
    value: null,
    valueCiphertext: 'cipher==',
    isSecret: true,
    description: null,
    createdByUserId: 'user-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
function configRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    tenantId: 'test-tenant-id',
    kind: 'CONFIG',
    key: 'REGION',
    value: 'us-east-1',
    valueCiphertext: null,
    isSecret: false,
    description: null,
    createdByUserId: 'user-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  _clearAuthzCache()
})

describe('POST /secrets', () => {
  it('creates a secret, encrypts the value, and never returns it', async () => {
    mockEncrypt.mockResolvedValue('cipher==')
    mockRepo.create.mockResolvedValue(secretRow())
    const app = buildApp(['tenant_admin'])
    const res = await app.request(
      '/workflow-secrets-configs/secrets',
      post({ key: 'DB_PASSWORD', value: 's3cr3t' }),
    )
    expect(res.status).toBe(201)
    const body = await json(res)
    const data = body['data'] as Record<string, unknown>
    expect(data['key']).toBe('DB_PASSWORD')
    expect(data['isSecret']).toBe(true)
    expect(data['value']).toBeUndefined()
    expect(data['valueCiphertext']).toBeUndefined()
    expect(mockEncrypt).toHaveBeenCalledWith('s3cr3t', 'test-tenant-id')
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'SECRET', key: 'DB_PASSWORD', valueCiphertext: 'cipher==' }),
    )
  })

  it('rejects a role without ManageWorkflowSecrets (workflow_runtime) with 403', async () => {
    const app = buildApp(['workflow_runtime'])
    const res = await app.request(
      '/workflow-secrets-configs/secrets',
      post({ key: 'DB_PASSWORD', value: 's3cr3t' }),
    )
    expect(res.status).toBe(403)
    expect(mockRepo.create).not.toHaveBeenCalled()
  })

  it('returns 409 on a duplicate key', async () => {
    mockEncrypt.mockResolvedValue('cipher==')
    mockRepo.create.mockRejectedValue(new Error('Unique constraint failed'))
    const app = buildApp(['tenant_admin'])
    const res = await app.request(
      '/workflow-secrets-configs/secrets',
      post({ key: 'DB_PASSWORD', value: 's3cr3t' }),
    )
    expect(res.status).toBe(409)
    expect((await json(res))['code']).toBe('CONFLICT')
  })

  it('returns 400 on an invalid key', async () => {
    const app = buildApp(['tenant_admin'])
    const res = await app.request(
      '/workflow-secrets-configs/secrets',
      post({ key: '1-bad key', value: 's3cr3t' }),
    )
    expect(res.status).toBe(400)
    expect(mockEncrypt).not.toHaveBeenCalled()
  })
})

describe('GET /secrets', () => {
  it('lists metadata without any value or ciphertext', async () => {
    mockRepo.listByKind.mockResolvedValue([secretRow()])
    const app = buildApp(['tenant_admin'])
    const res = await app.request('/workflow-secrets-configs/secrets')
    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as Array<Record<string, unknown>>
    expect(data[0]?.['key']).toBe('DB_PASSWORD')
    expect(data[0]?.['value']).toBeUndefined()
    expect(data[0]?.['valueCiphertext']).toBeUndefined()
    expect(mockRepo.listByKind).toHaveBeenCalledWith('SECRET')
  })
})

describe('DELETE /secrets/:key', () => {
  it('returns 204 on delete', async () => {
    mockRepo.deleteByKey.mockResolvedValue(1)
    const app = buildApp(['tenant_admin'])
    const res = await app.request('/workflow-secrets-configs/secrets/DB_PASSWORD', {
      method: 'DELETE',
    })
    expect(res.status).toBe(204)
    expect(mockRepo.deleteByKey).toHaveBeenCalledWith('SECRET', 'DB_PASSWORD')
  })

  it('returns 404 when the secret is absent', async () => {
    mockRepo.deleteByKey.mockResolvedValue(0)
    const app = buildApp(['tenant_admin'])
    const res = await app.request('/workflow-secrets-configs/secrets/NOPE', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})

describe('configs management', () => {
  it('POST /configs creates an entry with a plain value', async () => {
    mockRepo.create.mockResolvedValue(configRow())
    const app = buildApp(['tenant_admin'])
    const res = await app.request(
      '/workflow-secrets-configs/configs',
      post({ key: 'REGION', value: 'us-east-1' }),
    )
    expect(res.status).toBe(201)
    expect((await json(res))['data']).toMatchObject({
      key: 'REGION',
      value: 'us-east-1',
      isSecret: false,
    })
  })

  it('PUT /configs/:key updates an existing entry', async () => {
    mockRepo.findByKey.mockResolvedValue(configRow())
    mockRepo.update.mockResolvedValue(configRow({ value: 'us-west-2' }))
    const app = buildApp(['tenant_admin'])
    const res = await app.request(
      '/workflow-secrets-configs/configs/REGION',
      put({ value: 'us-west-2' }),
    )
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toMatchObject({ value: 'us-west-2' })
    expect(mockRepo.update).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({ value: 'us-west-2' }),
    )
  })

  it('PUT /configs/:key creates when absent (201)', async () => {
    mockRepo.findByKey.mockResolvedValue(null)
    mockRepo.create.mockResolvedValue(configRow({ value: 'eu-west-1' }))
    const app = buildApp(['tenant_admin'])
    const res = await app.request(
      '/workflow-secrets-configs/configs/REGION',
      put({ value: 'eu-west-1' }),
    )
    expect(res.status).toBe(201)
    expect(mockRepo.create).toHaveBeenCalled()
  })
})

describe('GET /runtime/secrets/:key', () => {
  it('decrypts and returns the value for workflow_runtime', async () => {
    mockRepo.findByKey.mockResolvedValue(secretRow())
    mockDecrypt.mockResolvedValue('s3cr3t')
    const app = buildApp(['workflow_runtime'], null)
    const res = await app.request('/workflow-secrets-configs/runtime/secrets/DB_PASSWORD')
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toEqual({ value: 's3cr3t' })
    expect(mockDecrypt).toHaveBeenCalledWith('cipher==', 'test-tenant-id')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('rejects a role without ReadWorkflowSecret (workflow_developer) with 403', async () => {
    const app = buildApp(['workflow_developer'])
    const res = await app.request('/workflow-secrets-configs/runtime/secrets/DB_PASSWORD')
    expect(res.status).toBe(403)
    expect(mockDecrypt).not.toHaveBeenCalled()
  })

  it('returns 404 when the secret does not exist', async () => {
    mockRepo.findByKey.mockResolvedValue(null)
    const app = buildApp(['workflow_runtime'], null)
    const res = await app.request('/workflow-secrets-configs/runtime/secrets/NOPE')
    expect(res.status).toBe(404)
  })
})

describe('GET /runtime/configs/:key', () => {
  it('returns the config value for workflow_runtime', async () => {
    mockRepo.findByKey.mockResolvedValue(configRow())
    const app = buildApp(['workflow_runtime'], null)
    const res = await app.request('/workflow-secrets-configs/runtime/configs/REGION')
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toEqual({ value: 'us-east-1' })
  })

  it('returns 404 when the config does not exist', async () => {
    mockRepo.findByKey.mockResolvedValue(null)
    const app = buildApp(['workflow_runtime'], null)
    const res = await app.request('/workflow-secrets-configs/runtime/configs/NOPE')
    expect(res.status).toBe(404)
  })
})

describe('management edge cases', () => {
  it('POST /secrets without an authenticated user → 422', async () => {
    mockEncrypt.mockResolvedValue('cipher==')
    const app = buildApp(['tenant_admin'], null)
    const res = await app.request(
      '/workflow-secrets-configs/secrets',
      post({ key: 'DB_PASSWORD', value: 's3cr3t' }),
    )
    expect(res.status).toBe(422)
    expect(mockRepo.create).not.toHaveBeenCalled()
  })

  it('POST /configs returns 409 on a duplicate key', async () => {
    mockRepo.create.mockRejectedValue(new Error('Unique constraint failed'))
    const app = buildApp(['tenant_admin'])
    const res = await app.request(
      '/workflow-secrets-configs/configs',
      post({ key: 'REGION', value: 'us-east-1' }),
    )
    expect(res.status).toBe(409)
    expect((await json(res))['code']).toBe('CONFLICT')
  })

  it('POST /configs returns 400 on an invalid key', async () => {
    const app = buildApp(['tenant_admin'])
    const res = await app.request(
      '/workflow-secrets-configs/configs',
      post({ key: '9bad', value: 'x' }),
    )
    expect(res.status).toBe(400)
    expect(mockRepo.create).not.toHaveBeenCalled()
  })

  it('POST /configs without an authenticated user → 422', async () => {
    const app = buildApp(['tenant_admin'], null)
    const res = await app.request(
      '/workflow-secrets-configs/configs',
      post({ key: 'REGION', value: 'us-east-1' }),
    )
    expect(res.status).toBe(422)
  })

  it('POST /configs rejects a role without ManageWorkflowConfigs (workflow_runtime) with 403', async () => {
    const app = buildApp(['workflow_runtime'])
    const res = await app.request(
      '/workflow-secrets-configs/configs',
      post({ key: 'REGION', value: 'us-east-1' }),
    )
    expect(res.status).toBe(403)
  })

  it('PUT /configs/:key returns 400 on an invalid key', async () => {
    const app = buildApp(['tenant_admin'])
    const res = await app.request('/workflow-secrets-configs/configs/9bad', put({ value: 'x' }))
    expect(res.status).toBe(400)
    expect(mockRepo.findByKey).not.toHaveBeenCalled()
  })

  it('PUT /configs/:key without an authenticated user → 422', async () => {
    const app = buildApp(['tenant_admin'], null)
    const res = await app.request('/workflow-secrets-configs/configs/REGION', put({ value: 'x' }))
    expect(res.status).toBe(422)
  })

  it('DELETE /configs/:key returns 204 then 404 when absent', async () => {
    mockRepo.deleteByKey.mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    const app = buildApp(['tenant_admin'])
    const ok = await app.request('/workflow-secrets-configs/configs/REGION', { method: 'DELETE' })
    expect(ok.status).toBe(204)
    expect(mockRepo.deleteByKey).toHaveBeenCalledWith('CONFIG', 'REGION')
    const missing = await app.request('/workflow-secrets-configs/configs/NOPE', {
      method: 'DELETE',
    })
    expect(missing.status).toBe(404)
  })

  it('GET /configs lists entries with values', async () => {
    mockRepo.listByKind.mockResolvedValue([configRow()])
    const app = buildApp(['tenant_admin'])
    const res = await app.request('/workflow-secrets-configs/configs')
    expect(res.status).toBe(200)
    expect(mockRepo.listByKind).toHaveBeenCalledWith('CONFIG')
    const data = (await json(res))['data'] as Array<Record<string, unknown>>
    expect(data[0]?.['value']).toBe('us-east-1')
  })
})

describe('runtime read edge cases', () => {
  it('GET /runtime/secrets/:key returns 404 when the row has no ciphertext', async () => {
    mockRepo.findByKey.mockResolvedValue(secretRow({ valueCiphertext: null }))
    const app = buildApp(['workflow_runtime'], null)
    const res = await app.request('/workflow-secrets-configs/runtime/secrets/DB_PASSWORD')
    expect(res.status).toBe(404)
    expect(mockDecrypt).not.toHaveBeenCalled()
  })

  it('GET /runtime/configs/:key rejects a role without ReadWorkflowConfig with 403', async () => {
    const app = buildApp(['workflow_developer'])
    const res = await app.request('/workflow-secrets-configs/runtime/configs/REGION')
    expect(res.status).toBe(403)
  })
})
