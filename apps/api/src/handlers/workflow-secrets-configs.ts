// ---------------------------------------------------------------------------
// /api/v1/workflow-secrets-configs — per-tenant secrets & configuration store
// that running workflows read at runtime via the SDK (PegasusClient.get_secret /
// get_config).
//
// Two surfaces, one handler, all mounted on dualAuthMiddleware (Cognito session
// for the SPA OR a vnd_ M2M key), exactly like /workflows and /event-types:
//
//   Management (tenant_admin / workflow_developer — Cognito session):
//     GET    /secrets            list secret metadata (NEVER any value)
//     POST   /secrets            create a secret (write-once; value encrypted)
//     DELETE /secrets/:key       delete a secret
//     GET    /configs            list config entries (plain values)
//     POST   /configs            create a config entry
//     PUT    /configs/:key       upsert a config value
//     DELETE /configs/:key       delete a config entry
//
//   Runtime (workflow_runtime — vnd_ key, action declared in manifest):
//     GET    /runtime/secrets/:key   decrypt + return { value }
//     GET    /runtime/configs/:key   return { value }
//
// SECRET values are KMS-encrypted at rest (secret-value-crypto.ts) and the
// plaintext is NEVER returned by the management surface — only the two /runtime
// routes (gated by ReadWorkflowSecret / ReadWorkflowConfig) ever emit a value.
// Secrets are write-once: rotation is DELETE then POST (no PUT /secrets/:key).
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { DomainError } from '@pegasus/domain'
import type { AppEnv } from '../types'
import { Actions } from '../authz/actions'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { requirePermission } from '../middleware/rbac'
import {
  createWorkflowSecretConfigRepository,
  type WorkflowSecretConfigRow,
} from '../repositories/workflow-secret-config.repository'
import { encryptSecretValue, decryptSecretValue } from '../lib/secret-value-crypto'
import { logger } from '../lib/logger'

/** Env-var-style key: letter/underscore then word chars, ≤128 chars total. */
const KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/

const KEY_HELP = 'key must match [a-zA-Z_][a-zA-Z0-9_]{0,127}'

const CreateSecretBody = z
  .object({
    key: z.string(),
    value: z.string().min(1).max(65536),
    description: z.string().max(500).optional(),
  })
  .strict()

const CreateConfigBody = z
  .object({
    key: z.string(),
    value: z.string().max(65536),
    description: z.string().max(500).optional(),
  })
  .strict()

const UpsertConfigBody = z
  .object({
    value: z.string().max(65536),
    description: z.string().max(500).nullable().optional(),
  })
  .strict()

/** Secret metadata — NEVER includes value or ciphertext. */
function toSecretResponse(row: WorkflowSecretConfigRow) {
  return {
    id: row.id,
    key: row.key,
    description: row.description,
    isSecret: true as const,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Config entry — value is plain and shown. */
function toConfigResponse(row: WorkflowSecretConfigRow) {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    description: row.description,
    isSecret: false as const,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return String(err).includes('Unique constraint')
}

export const workflowSecretsConfigsHandler = new Hono<AppEnv>()

workflowSecretsConfigsHandler.use('*', dualAuthMiddleware)

// ── Secrets — management ───────────────────────────────────────────────────

// GET /secrets — list secret metadata (no values).
workflowSecretsConfigsHandler.get(
  '/secrets',
  requirePermission(Actions.ManageWorkflowSecrets),
  async (c) => {
    const repo = createWorkflowSecretConfigRepository(c.get('db'))
    const rows = await repo.listByKind('SECRET')
    return c.json({ data: rows.map(toSecretResponse) })
  },
)

// POST /secrets — create a write-once secret. The value is KMS-encrypted; the
// response carries metadata only, never the value.
workflowSecretsConfigsHandler.post(
  '/secrets',
  requirePermission(Actions.ManageWorkflowSecrets),
  validator('json', (value, c) => {
    const r = CreateSecretBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    if (!userId) {
      throw new DomainError('Authenticated user required to manage secrets', 'UNAUTHENTICATED')
    }
    const body = c.req.valid('json')
    if (!KEY_RE.test(body.key)) {
      return c.json({ error: KEY_HELP, code: 'VALIDATION_ERROR' }, 400)
    }

    const ciphertext = await encryptSecretValue(body.value, tenantId)
    const repo = createWorkflowSecretConfigRepository(c.get('db'))
    try {
      const row = await repo.create({
        tenantId,
        kind: 'SECRET',
        key: body.key,
        valueCiphertext: ciphertext,
        description: body.description ?? null,
        createdByUserId: userId,
      })
      logger.info('Workflow secret created', { id: row.id, key: row.key, tenantId })
      return c.json({ data: toSecretResponse(row) }, 201)
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return c.json(
          { error: `A secret named "${body.key}" already exists`, code: 'CONFLICT' },
          409,
        )
      }
      throw err
    }
  },
)

// DELETE /secrets/:key — remove a secret.
workflowSecretsConfigsHandler.delete(
  '/secrets/:key',
  requirePermission(Actions.ManageWorkflowSecrets),
  async (c) => {
    const repo = createWorkflowSecretConfigRepository(c.get('db'))
    const count = await repo.deleteByKey('SECRET', c.req.param('key') ?? '')
    if (count === 0) return c.json({ error: 'Secret not found', code: 'NOT_FOUND' }, 404)
    return c.body(null, 204)
  },
)

// ── Configs — management ───────────────────────────────────────────────────

// GET /configs — list config entries with plain values.
workflowSecretsConfigsHandler.get(
  '/configs',
  requirePermission(Actions.ManageWorkflowConfigs),
  async (c) => {
    const repo = createWorkflowSecretConfigRepository(c.get('db'))
    const rows = await repo.listByKind('CONFIG')
    return c.json({ data: rows.map(toConfigResponse) })
  },
)

// POST /configs — create a config entry.
workflowSecretsConfigsHandler.post(
  '/configs',
  requirePermission(Actions.ManageWorkflowConfigs),
  validator('json', (value, c) => {
    const r = CreateConfigBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    if (!userId) {
      throw new DomainError('Authenticated user required to manage config', 'UNAUTHENTICATED')
    }
    const body = c.req.valid('json')
    if (!KEY_RE.test(body.key)) {
      return c.json({ error: KEY_HELP, code: 'VALIDATION_ERROR' }, 400)
    }

    const repo = createWorkflowSecretConfigRepository(c.get('db'))
    try {
      const row = await repo.create({
        tenantId,
        kind: 'CONFIG',
        key: body.key,
        value: body.value,
        description: body.description ?? null,
        createdByUserId: userId,
      })
      logger.info('Workflow config created', { id: row.id, key: row.key, tenantId })
      return c.json({ data: toConfigResponse(row) }, 201)
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return c.json(
          { error: `A config entry named "${body.key}" already exists`, code: 'CONFLICT' },
          409,
        )
      }
      throw err
    }
  },
)

// PUT /configs/:key — upsert a config value (create if absent, else replace).
workflowSecretsConfigsHandler.put(
  '/configs/:key',
  requirePermission(Actions.ManageWorkflowConfigs),
  validator('json', (value, c) => {
    const r = UpsertConfigBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    if (!userId) {
      throw new DomainError('Authenticated user required to manage config', 'UNAUTHENTICATED')
    }
    const key = c.req.param('key') ?? ''
    if (!KEY_RE.test(key)) {
      return c.json({ error: KEY_HELP, code: 'VALIDATION_ERROR' }, 400)
    }
    const body = c.req.valid('json')

    const repo = createWorkflowSecretConfigRepository(c.get('db'))
    const existing = await repo.findByKey('CONFIG', key)
    if (existing) {
      const row = await repo.update(existing.id, {
        value: body.value,
        ...(body.description !== undefined ? { description: body.description } : {}),
      })
      return c.json({ data: toConfigResponse(row) })
    }
    const row = await repo.create({
      tenantId,
      kind: 'CONFIG',
      key,
      value: body.value,
      description: body.description ?? null,
      createdByUserId: userId,
    })
    return c.json({ data: toConfigResponse(row) }, 201)
  },
)

// DELETE /configs/:key — remove a config entry.
workflowSecretsConfigsHandler.delete(
  '/configs/:key',
  requirePermission(Actions.ManageWorkflowConfigs),
  async (c) => {
    const repo = createWorkflowSecretConfigRepository(c.get('db'))
    const count = await repo.deleteByKey('CONFIG', c.req.param('key') ?? '')
    if (count === 0) return c.json({ error: 'Config entry not found', code: 'NOT_FOUND' }, 404)
    return c.body(null, 204)
  },
)

// ── Runtime reads (vnd_ runtime key) ───────────────────────────────────────

// GET /runtime/secrets/:key — decrypt and return a single secret value.
workflowSecretsConfigsHandler.get(
  '/runtime/secrets/:key',
  requirePermission(Actions.ReadWorkflowSecret),
  async (c) => {
    const tenantId = c.get('tenantId')
    const repo = createWorkflowSecretConfigRepository(c.get('db'))
    const row = await repo.findByKey('SECRET', c.req.param('key') ?? '')
    if (!row || !row.valueCiphertext) {
      return c.json({ error: 'Secret not found', code: 'NOT_FOUND' }, 404)
    }
    const value = await decryptSecretValue(row.valueCiphertext, tenantId)
    return c.json({ data: { value } }, 200, { 'Cache-Control': 'no-store' })
  },
)

// GET /runtime/configs/:key — return a single config value.
workflowSecretsConfigsHandler.get(
  '/runtime/configs/:key',
  requirePermission(Actions.ReadWorkflowConfig),
  async (c) => {
    const repo = createWorkflowSecretConfigRepository(c.get('db'))
    const row = await repo.findByKey('CONFIG', c.req.param('key') ?? '')
    if (!row) return c.json({ error: 'Config entry not found', code: 'NOT_FOUND' }, 404)
    return c.json({ data: { value: row.value } })
  },
)
