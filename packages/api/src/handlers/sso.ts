// ---------------------------------------------------------------------------
// SSO handler — /api/v1/sso/**
//
// Tenant-protected endpoints for managing SSO identity provider configuration.
// All routes sit behind the tenant middleware, so tenantId is always resolved.
//
// Endpoints:
//   GET    /providers          — list all providers for the tenant (no secrets)
//   POST   /providers          — add a new provider; provisions IdP in Cognito
//   PUT    /providers/:id      — update a provider; syncs changes to Cognito
//   DELETE /providers/:id      — remove a provider; deletes IdP from Cognito first
//
// Security invariants:
//   - secretArn is NEVER returned in any response. It is a Secrets Manager ARN
//     reference for future Cognito provisioning automation; it must stay server-
//     side only.
//   - oidcClientSecret is NEVER persisted to the DB or returned in any response.
//     It flows only to the Cognito CreateIdentityProvider / UpdateIdentityProvider
//     API call.
//   - cognitoProviderName is immutable after creation — it is the stable
//     identifier used in Cognito and in the authorize URL. To change it, delete
//     and recreate the provider.
//   - Phase 5 will add an RBAC check so only tenant_admin users can call these
//     endpoints. For now, any authenticated tenant session can manage providers.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import {
  CognitoIdentityProviderClient,
  CreateIdentityProviderCommand,
  UpdateIdentityProviderCommand,
  DeleteIdentityProviderCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import type { AppEnv } from '../types'
import { logger } from '../lib/logger'

// ---------------------------------------------------------------------------
// Cognito client singleton — reused across warm invocations
// ---------------------------------------------------------------------------
const cognito = new CognitoIdentityProviderClient({})
const USER_POOL_ID = process.env['COGNITO_USER_POOL_ID'] ?? ''

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

  /**
   * OIDC only: the client secret issued by the IdP.
   * Passed directly to Cognito — NEVER persisted to the DB or returned in any response.
   */
  oidcClientSecret: z.string().min(1).optional(),

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

  /**
   * OIDC only: updated client secret.
   * Passed directly to Cognito — NEVER persisted to the DB or returned in any response.
   */
  oidcClientSecret: z.string().min(1).optional(),

  /** Toggle whether the provider is offered on the login page. */
  isEnabled: z.boolean().optional(),
})

// ---------------------------------------------------------------------------
// Shape returned to clients — secretArn and oidcClientSecret always excluded.
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

/**
 * Strips the `/.well-known/openid-configuration` suffix from a metadata URL
 * if present. Cognito expects the issuer root URL and appends the suffix itself.
 */
function toOidcIssuer(metadataUrl: string): string {
  return metadataUrl.replace(/\/.well-known\/openid-configuration$/, '')
}

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
// Adds a new SSO provider for this tenant, then provisions the IdP in Cognito.
// If Cognito provisioning fails, the DB record is rolled back to maintain
// consistency.
//
// Request:  CreateSsoProviderBody
// Response: { data: SsoProviderResponse } (201)
//           { error, code: VALIDATION_ERROR }     (400)
//           { error, code: CONFLICT }             (409) — cognitoProviderName already exists
//           { error, code: INTERNAL_ERROR }       (500) — DB or Cognito failure
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

    // Step 1 — Persist to DB
    let provider: ProviderRow
    try {
      provider = await db.tenantSsoProvider.create({
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

    // Step 2 — Provision in Cognito (oidcClientSecret flows here only, never persisted)
    const providerDetails: Record<string, string> =
      body.type === 'OIDC'
        ? {
            ...(body.oidcClientId !== undefined ? { client_id: body.oidcClientId } : {}),
            ...(body.oidcClientSecret !== undefined ? { client_secret: body.oidcClientSecret } : {}),
            attributes_request_method: 'GET',
            ...(body.metadataUrl !== undefined
              ? { oidc_issuer: toOidcIssuer(body.metadataUrl) }
              : {}),
            authorize_scopes: 'openid email profile',
          }
        : {
            ...(body.metadataUrl !== undefined ? { MetadataURL: body.metadataUrl } : {}),
          }

    try {
      await cognito.send(
        new CreateIdentityProviderCommand({
          UserPoolId: USER_POOL_ID,
          ProviderName: body.cognitoProviderName,
          ProviderType: body.type,
          ProviderDetails: providerDetails,
          AttributeMapping: { email: 'email' },
        }),
      )
    } catch (cognitoErr) {
      logger.error(
        'POST /providers: Cognito CreateIdentityProvider failed, rolling back DB record',
        { error: String(cognitoErr), providerId: provider.id },
      )
      await db.tenantSsoProvider.delete({ where: { id: provider.id } })
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }

    return c.json({ data: toResponse(provider) }, 201)
  },
)

// ---------------------------------------------------------------------------
// PUT /providers/:id
//
// Updates mutable fields on an existing provider, then syncs the changes to
// Cognito. cognitoProviderName and type are immutable — to change them, delete
// and recreate the provider (preserving Cognito registration integrity).
//
// If Cognito sync fails, the DB is already updated. The caller should retry.
//
// Request:  UpdateSsoProviderBody (all fields optional)
// Response: { data: SsoProviderResponse } (200)
//           { error, code: NOT_FOUND }        (404)
//           { error, code: VALIDATION_ERROR } (400)
//           { error, code: INTERNAL_ERROR }   (500) — DB or Cognito failure
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

    // Step 1 — Fetch existing record (needed for Cognito call context)
    let existing: {
      id: string
      cognitoProviderName: string
      type: 'OIDC' | 'SAML'
      metadataUrl: string | null
      oidcClientId: string | null
    } | null
    let provider: ProviderRow
    try {
      existing = await db.tenantSsoProvider.findUnique({
        where: { id },
        select: {
          id: true,
          cognitoProviderName: true,
          type: true,
          metadataUrl: true,
          oidcClientId: true,
        },
      })
      if (!existing) return c.json({ error: 'SSO provider not found', code: 'NOT_FOUND' }, 404)

      // Step 2 — Update DB
      provider = await db.tenantSsoProvider.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.metadataUrl !== undefined ? { metadataUrl: body.metadataUrl } : {}),
          ...(body.oidcClientId !== undefined ? { oidcClientId: body.oidcClientId } : {}),
          ...(body.isEnabled !== undefined ? { isEnabled: body.isEnabled } : {}),
        },
        select: PROVIDER_SELECT,
      })
    } catch (err) {
      logger.error('PUT /providers/:id: failed to update SSO provider', { error: String(err) })
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }

    // Step 3 — Sync to Cognito (merged state: updated fields take priority)
    const effectiveMetadataUrl = body.metadataUrl ?? existing.metadataUrl
    const effectiveClientId = body.oidcClientId ?? existing.oidcClientId
    const providerDetails: Record<string, string> =
      existing.type === 'OIDC'
        ? {
            ...(effectiveClientId !== null ? { client_id: effectiveClientId } : {}),
            ...(body.oidcClientSecret !== undefined
              ? { client_secret: body.oidcClientSecret }
              : {}),
            attributes_request_method: 'GET',
            ...(effectiveMetadataUrl !== null
              ? { oidc_issuer: toOidcIssuer(effectiveMetadataUrl) }
              : {}),
            authorize_scopes: 'openid email profile',
          }
        : {
            ...(effectiveMetadataUrl !== null ? { MetadataURL: effectiveMetadataUrl } : {}),
          }

    try {
      await cognito.send(
        new UpdateIdentityProviderCommand({
          UserPoolId: USER_POOL_ID,
          ProviderName: existing.cognitoProviderName,
          ProviderDetails: providerDetails,
        }),
      )
    } catch (cognitoErr) {
      logger.error('PUT /providers/:id: Cognito UpdateIdentityProvider failed', {
        error: String(cognitoErr),
        providerId: id,
      })
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }

    return c.json({ data: toResponse(provider) })
  },
)

// ---------------------------------------------------------------------------
// DELETE /providers/:id
//
// Removes an SSO provider. Deletes the IdP from Cognito first, then removes
// the DB record. ResourceNotFoundException / NotAuthorizedException from
// Cognito is treated as idempotent (IdP already gone) so the DB cleanup still
// proceeds. Any other Cognito error halts the delete to avoid orphaned DB
// records.
//
// Response: 204 No Content
//           { error, code: NOT_FOUND }        (404)
//           { error, code: INTERNAL_ERROR }   (500) — Cognito or DB failure
// ---------------------------------------------------------------------------
ssoHandler.delete('/providers/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  // Step 1 — Fetch existing (need cognitoProviderName for Cognito call)
  let existing: { id: string; cognitoProviderName: string } | null
  try {
    existing = await db.tenantSsoProvider.findUnique({
      where: { id },
      select: { id: true, cognitoProviderName: true },
    })
  } catch (err) {
    logger.error('DELETE /providers/:id: failed to fetch SSO provider', { error: String(err) })
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
  if (!existing) return c.json({ error: 'SSO provider not found', code: 'NOT_FOUND' }, 404)

  // Step 2 — Remove from Cognito
  try {
    await cognito.send(
      new DeleteIdentityProviderCommand({
        UserPoolId: USER_POOL_ID,
        ProviderName: existing.cognitoProviderName,
      }),
    )
  } catch (cognitoErr) {
    const errName =
      typeof cognitoErr === 'object' && cognitoErr !== null && 'name' in cognitoErr
        ? (cognitoErr as { name: string }).name
        : ''
    if (errName === 'ResourceNotFoundException' || errName === 'NotAuthorizedException') {
      logger.warn(
        'DELETE /providers/:id: Cognito IdP already gone, continuing with DB cleanup',
        { error: String(cognitoErr), providerId: id },
      )
    } else {
      logger.error('DELETE /providers/:id: Cognito DeleteIdentityProvider failed', {
        error: String(cognitoErr),
        providerId: id,
      })
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  }

  // Step 3 — Remove from DB
  try {
    await db.tenantSsoProvider.delete({ where: { id } })
  } catch (err) {
    logger.error('DELETE /providers/:id: failed to delete SSO provider from DB', {
      error: String(err),
    })
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }

  return c.body(null, 204)
})
