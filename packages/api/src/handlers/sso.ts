// ---------------------------------------------------------------------------
// SSO handler — /api/v1/sso/**
//
// Tenant-protected endpoints for managing SSO identity provider configuration.
// All routes sit behind the tenant middleware, so tenantId is always resolved.
//
// Endpoints:
//   GET    /providers          — list all providers for the tenant (no secrets)
//   POST   /providers          — add a new provider
//   PUT    /providers/:id      — update a provider (name, metadataUrl, oidcClientId, isEnabled)
//   DELETE /providers/:id      — remove a provider
//
// Security invariants:
//   - secretArn is NEVER returned in any response. It is a Secrets Manager ARN
//     reference for future Cognito provisioning automation; it must stay server-
//     side only.
//   - cognitoProviderName is immutable after creation — it is the stable
//     identifier used in Cognito and in the authorize URL. To change it, delete
//     and recreate the provider.
//   - Phase 5 will add an RBAC check so only tenant_admin users can call these
//     endpoints. For now, any authenticated tenant session can manage providers.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { AppEnv } from '../types'
import { logger } from '../lib/logger'

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const SsoProviderTypeEnum = z.enum(['OIDC', 'SAML'])

const CreateSsoProviderBody = z.object({
  /** Display name shown in the login page provider picker. */
  name: z.string().min(1).max(100),

  /** Protocol type: OIDC or SAML. */
  type: SsoProviderTypeEnum,

  /**
   * The Cognito identity provider name. Must exactly match the name registered
   * in the Cognito User Pool (case-sensitive). Passed as `identity_provider`
   * in the authorization URL. Immutable after creation.
   */
  cognitoProviderName: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/, {
      message: 'cognitoProviderName may only contain letters, digits, hyphens, and underscores',
    }),

  /**
   * OIDC: discovery document URL (e.g. https://accounts.google.com/.well-known/openid-configuration).
   * SAML: metadata URL served by the IdP.
   */
  metadataUrl: z.string().url().optional(),

  /**
   * OIDC only: the client ID issued by the IdP. Must be omitted or null for
   * SAML providers.
   */
  oidcClientId: z.string().min(1).optional(),

  /** Whether this provider should appear on the login page. Defaults to true. */
  isEnabled: z.boolean().optional(),
})

const UpdateSsoProviderBody = z.object({
  /** Rename the display name shown in the provider picker. */
  name: z.string().min(1).max(100).optional(),

  /**
   * OIDC: updated discovery document URL.
   * SAML: updated metadata URL.
   */
  metadataUrl: z.string().url().optional(),

  /** OIDC only: updated client ID. */
  oidcClientId: z.string().min(1).optional(),

  /** Toggle whether the provider is offered on the login page. */
  isEnabled: z.boolean().optional(),
})

// ---------------------------------------------------------------------------
// Shape returned to clients — secretArn is always excluded.
// ---------------------------------------------------------------------------
type SsoProviderResponse = {
  id: string
  name: string
  type: 'OIDC' | 'SAML'
  cognitoProviderName: string
  metadataUrl: string | null
  oidcClientId: string | null
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

// Prisma row type (subset of what we select)
type ProviderRow = {
  id: string
  name: string
  type: 'OIDC' | 'SAML'
  cognitoProviderName: string
  metadataUrl: string | null
  oidcClientId: string | null
  isEnabled: boolean
  createdAt: Date
  updatedAt: Date
}

function toResponse(row: ProviderRow): SsoProviderResponse {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    cognitoProviderName: row.cognitoProviderName,
    metadataUrl: row.metadataUrl,
    oidcClientId: row.oidcClientId,
    isEnabled: row.isEnabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Fields to select — secretArn is deliberately excluded from every query. */
const PROVIDER_SELECT = {
  id: true,
  name: true,
  type: true,
  cognitoProviderName: true,
  metadataUrl: true,
  oidcClientId: true,
  isEnabled: true,
  createdAt: true,
  updatedAt: true,
} as const

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export const ssoHandler = new Hono<AppEnv>()

// ---------------------------------------------------------------------------
// GET /providers
//
// Lists all SSO providers configured for this tenant.
// Returns both enabled and disabled providers so the admin can manage them.
// secretArn is never included.
//
// Response: { data: SsoProviderResponse[] }
// ---------------------------------------------------------------------------
ssoHandler.get('/providers', async (c) => {
  const db = c.get('db')
  try {
    const providers = await db.tenantSsoProvider.findMany({
      select: PROVIDER_SELECT,
      orderBy: { createdAt: 'asc' },
    })
    return c.json({ data: providers.map(toResponse) })
  } catch (err) {
    logger.error('GET /providers: failed to list SSO providers', { error: String(err) })
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

// ---------------------------------------------------------------------------
// POST /providers
//
// Adds a new SSO provider for this tenant.
//
// Request:  CreateSsoProviderBody
// Response: { data: SsoProviderResponse } (201)
//           { error, code: VALIDATION_ERROR }     (400)
//           { error, code: CONFLICT }             (409) — cognitoProviderName already exists
// ---------------------------------------------------------------------------
ssoHandler.post(
  '/providers',
  validator('json', (value, c) => {
    const r = CreateSsoProviderBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const tenantId = c.get('tenantId')
    const body = c.req.valid('json')

    try {
      const provider = await db.tenantSsoProvider.create({
        data: {
          tenantId,
          name: body.name,
          type: body.type,
          cognitoProviderName: body.cognitoProviderName,
          ...(body.metadataUrl !== undefined ? { metadataUrl: body.metadataUrl } : {}),
          ...(body.oidcClientId !== undefined ? { oidcClientId: body.oidcClientId } : {}),
          ...(body.isEnabled !== undefined ? { isEnabled: body.isEnabled } : {}),
        },
        select: PROVIDER_SELECT,
      })
      return c.json({ data: toResponse(provider) }, 201)
    } catch (err) {
      // Prisma P2002 = unique constraint violation (tenant + cognitoProviderName)
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        return c.json(
          {
            error: `A provider with cognitoProviderName "${body.cognitoProviderName}" already exists for this tenant`,
            code: 'CONFLICT',
          },
          409,
        )
      }
      logger.error('POST /providers: failed to create SSO provider', { error: String(err) })
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

// ---------------------------------------------------------------------------
// PUT /providers/:id
//
// Updates mutable fields on an existing provider.
// cognitoProviderName and type are immutable — to change them, delete and
// recreate the provider (preserving Cognito registration integrity).
//
// Request:  UpdateSsoProviderBody (all fields optional)
// Response: { data: SsoProviderResponse } (200)
//           { error, code: NOT_FOUND }        (404)
//           { error, code: VALIDATION_ERROR } (400)
// ---------------------------------------------------------------------------
ssoHandler.put(
  '/providers/:id',
  validator('json', (value, c) => {
    const r = UpdateSsoProviderBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const id = c.req.param('id')
    const body = c.req.valid('json')

    try {
      const existing = await db.tenantSsoProvider.findUnique({
        where: { id },
        select: { id: true },
      })
      if (!existing) return c.json({ error: 'SSO provider not found', code: 'NOT_FOUND' }, 404)

      const provider = await db.tenantSsoProvider.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.metadataUrl !== undefined ? { metadataUrl: body.metadataUrl } : {}),
          ...(body.oidcClientId !== undefined ? { oidcClientId: body.oidcClientId } : {}),
          ...(body.isEnabled !== undefined ? { isEnabled: body.isEnabled } : {}),
        },
        select: PROVIDER_SELECT,
      })
      return c.json({ data: toResponse(provider) })
    } catch (err) {
      logger.error('PUT /providers/:id: failed to update SSO provider', { error: String(err) })
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

// ---------------------------------------------------------------------------
// DELETE /providers/:id
//
// Removes an SSO provider. The caller should also remove the corresponding
// identity provider from the Cognito User Pool (Phase 4+ automation).
//
// Response: 204 No Content
//           { error, code: NOT_FOUND } (404)
// ---------------------------------------------------------------------------
ssoHandler.delete('/providers/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  try {
    const existing = await db.tenantSsoProvider.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return c.json({ error: 'SSO provider not found', code: 'NOT_FOUND' }, 404)

    await db.tenantSsoProvider.delete({ where: { id } })
    return c.body(null, 204)
  } catch (err) {
    logger.error('DELETE /providers/:id: failed to delete SSO provider', { error: String(err) })
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})
