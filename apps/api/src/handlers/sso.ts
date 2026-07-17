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
//   - oidcClientSecret is NEVER persisted to the DB or returned in any response.
//     It flows only to the Cognito CreateIdentityProvider / UpdateIdentityProvider
//     API call. Because we keep no copy, we cannot re-send it on a later sync —
//     see PUT below, which requires it whenever the Cognito config changes.
//   - secretArn is NEVER returned in any response. It is vestigial: it was meant to
//     reference a Secrets Manager ARN, but nothing has ever written it. Believing
//     that flow existed is what left the tenant-web form with no client-secret
//     field, registering OIDC providers that could never complete a login.
//   - cognitoProviderName is immutable after creation — it is the stable
//     identifier used in Cognito and in the authorize URL. To change it, delete
//     and recreate the provider.
//   - Every route requires ManageSsoProviders (sso:manage), which only
//     tenant_admin holds. This is load-bearing, not tidiness: a federated login
//     resolves its tenant from the provider it came through, then inherits the
//     roles rostered against the email it asserts. An ungated POST /providers
//     therefore let any tenant user register an IdP they control, assert the
//     admin's email, and mint tenant_admin claims for their own tenant.
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
import { requirePermission } from '../middleware/rbac'
import { Actions } from '../authz/actions'
import type { AppEnv } from '../types'
import { logger } from '../lib/logger'
import {
  addProviderToAppClient,
  removeProviderFromAppClient,
  reconcileAppClientProvidersSafely,
} from '../lib/cognito-app-client'

// ---------------------------------------------------------------------------
// Cognito client singleton — reused across warm invocations
// ---------------------------------------------------------------------------
const cognito = new CognitoIdentityProviderClient({})
const USER_POOL_ID = process.env['COGNITO_USER_POOL_ID'] ?? ''

// Registering an IdP in the pool does not make it usable — the app client must also
// list it in SupportedIdentityProviders, or Cognito redirects to the IdP, accepts the
// returned code, and then fails the callback with a bare 400 and no error_description.
const TENANT_CLIENT_ID = process.env['COGNITO_TENANT_CLIENT_ID'] ?? ''

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const SsoProviderTypeEnum = z.enum(['OIDC', 'SAML'])

const CreateSsoProviderBody = z
  .object({
    /** Display name shown in the login page provider picker. */
    name: z.string().min(1).max(100),

    /** Protocol type: OIDC or SAML. */
    type: SsoProviderTypeEnum,

    /**
     * The Cognito identity provider name. Chosen by the caller and CREATED in the
     * User Pool by this endpoint — it does not need to exist beforehand. Passed as
     * `identity_provider` in the authorization URL. The pool is shared across
     * tenants, so this must be unique pool-wide. Immutable after creation.
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
  // Cognito accepts an OIDC provider with no client_secret, but the resulting IdP
  // can never complete the authorization-code exchange — the failure only surfaces
  // as a 400 at /oauth2/idpresponse on a tenant's first real login attempt. Reject
  // the unusable shape here instead of registering it.
  .superRefine((val, ctx) => {
    if (val.type === 'OIDC') {
      if (val.metadataUrl === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['metadataUrl'],
          message: 'metadataUrl (the OIDC discovery URL) is required for OIDC providers',
        })
      }
      if (val.oidcClientId === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['oidcClientId'],
          message: 'oidcClientId is required for OIDC providers',
        })
      }
      if (val.oidcClientSecret === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['oidcClientSecret'],
          message:
            'oidcClientSecret is required for OIDC providers — without it Cognito cannot exchange the authorization code and every login fails',
        })
      }
      return
    }

    // SAML: Cognito needs MetadataURL (or MetadataFile) or it rejects the call.
    if (val.metadataUrl === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['metadataUrl'],
        message: 'metadataUrl (the SAML metadata URL) is required for SAML providers',
      })
    }
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
ssoHandler.get('/providers', requirePermission(Actions.ManageSsoProviders), async (c) => {
  const db = c.get('db')
  const tenantId = c.get('tenantId')
  try {
    const [providers, tenant] = await Promise.all([
      db.tenantSsoProvider.findMany({
        select: PROVIDER_SELECT,
        orderBy: { createdAt: 'asc' },
      }),
      db.tenant.findUnique({
        where: { id: tenantId },
        select: { cognitoAuthEnabled: true },
      }),
    ])

    // Repair drift on read. CDK's addClient renders SupportedIdentityProviders into the
    // CloudFormation template (defaulting to ['COGNITO']) even though cognito-stack.ts
    // never sets it, so CFN owns the field. CFN only rewrites resources whose template
    // properties change — runtime additions survive ordinary deploys — but the day
    // anyone edits the tenant app client in CDK, CFN resets the list and every tenant's
    // SSO breaks at once, silently. Reconciling here means the next visit to the SSO
    // settings page repairs it. Fail-open: never break the page over a failed repair.
    await reconcileAppClientProvidersSafely(
      cognito,
      USER_POOL_ID,
      TENANT_CLIENT_ID,
      providers.filter((p) => p.isEnabled).map((p) => p.cognitoProviderName),
    )

    return c.json({
      data: {
        providers: providers.map(toResponse),
        cognitoAuthEnabled: tenant?.cognitoAuthEnabled ?? true,
      },
    })
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
//           { error, code: VALIDATION_ERROR }     (400) — incl. an OIDC provider with
//                                                         no client secret/id/discovery
//                                                         URL, or SAML with no metadata
//           { error, code: CONFLICT }             (409) — name taken for this tenant
//                                                         (DB) or anywhere in the pool
//                                                         (Cognito duplicate)
//           { error, code: INTERNAL_ERROR }       (500) — DB or Cognito failure
// ---------------------------------------------------------------------------
ssoHandler.post(
  '/providers',
  requirePermission(Actions.ManageSsoProviders),
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
            ...(body.oidcClientSecret !== undefined
              ? { client_secret: body.oidcClientSecret }
              : {}),
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

      // The user pool is shared across tenants, so Cognito's ProviderName is unique
      // per POOL, while the DB constraint is only [tenantId, cognitoProviderName].
      // A name another tenant already holds passes the DB check and fails here.
      // Keep the message generic — naming the holder would leak across tenants.
      if ((cognitoErr as { name?: string }).name === 'DuplicateProviderException') {
        return c.json(
          {
            error: `The Cognito provider name "${body.cognitoProviderName}" is already taken. Choose a different one.`,
            code: 'CONFLICT',
          },
          409,
        )
      }
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }

    // Step 3 — Permit the provider on the tenant app client. Registering the IdP is
    // not enough: Cognito will still redirect to it and accept the returned code, then
    // fail the callback with a bare 400 and no error_description. Must run after
    // CreateIdentityProvider — Cognito rejects a name whose provider does not exist yet.
    try {
      await addProviderToAppClient(
        cognito,
        USER_POOL_ID,
        TENANT_CLIENT_ID,
        body.cognitoProviderName,
      )
    } catch (clientErr) {
      logger.error('POST /providers: failed to permit provider on app client, rolling back', {
        error: String(clientErr),
        providerId: provider.id,
        clientId: TENANT_CLIENT_ID,
      })

      // Roll back the IdP too, not just the DB row — otherwise we leave behind exactly
      // the registered-but-unusable provider this whole endpoint exists to prevent.
      try {
        await cognito.send(
          new DeleteIdentityProviderCommand({
            UserPoolId: USER_POOL_ID,
            ProviderName: body.cognitoProviderName,
          }),
        )
      } catch (cleanupErr) {
        // Surface it, but never let a failed cleanup mask the original failure.
        logger.error('POST /providers: rollback of Cognito IdP failed — manual cleanup needed', {
          error: String(cleanupErr),
          providerName: body.cognitoProviderName,
        })
      }

      await db.tenantSsoProvider.delete({ where: { id: provider.id } })
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }

    return c.json({ data: toResponse(provider) }, 201)
  },
)

// ---------------------------------------------------------------------------
// PUT /providers/:id
//
// Updates mutable fields on an existing provider. cognitoProviderName and type are
// immutable — to change them, delete and recreate the provider (preserving Cognito
// registration integrity).
//
// Cognito is synced ONLY when a field it actually stores changed (metadataUrl,
// oidcClientId, oidcClientSecret). A name- or isEnabled-only edit is DB-only:
// UpdateIdentityProvider replaces ProviderDetails wholesale and we never persist the
// client secret, so syncing such an edit would drop client_secret and break login.
// For the same reason, changing an OIDC provider's Cognito config requires the caller
// to re-supply the secret.
//
// If Cognito sync fails, the DB is already updated. The caller should retry.
//
// Request:  UpdateSsoProviderBody (all fields optional)
// Response: { data: SsoProviderResponse } (200)
//           { error, code: NOT_FOUND }        (404)
//           { error, code: VALIDATION_ERROR } (400) — incl. an OIDC config change with
//                                                     no oidcClientSecret re-supplied
//           { error, code: INTERNAL_ERROR }   (500) — DB or Cognito failure
// ---------------------------------------------------------------------------
ssoHandler.put(
  '/providers/:id',
  requirePermission(Actions.ManageSsoProviders),
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

    // Does this edit touch a field Cognito actually stores? `name` and `isEnabled`
    // live only in our DB. UpdateIdentityProvider replaces ProviderDetails wholesale
    // and we never persist the client secret, so re-syncing an edit that changed no
    // Cognito field would drop client_secret and silently break every login.
    const cognitoRelevantChange =
      body.metadataUrl !== undefined ||
      body.oidcClientId !== undefined ||
      body.oidcClientSecret !== undefined

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

      // The secret is never stored on our side, so we cannot re-send one we were not
      // given. If the Cognito config has to change on an OIDC provider, the caller
      // must supply the secret again. Checked before the DB write so a rejected edit
      // cannot leave the row describing a provider Cognito never received.
      if (
        cognitoRelevantChange &&
        existing.type === 'OIDC' &&
        body.oidcClientSecret === undefined
      ) {
        return c.json(
          {
            error:
              'oidcClientSecret is required when changing the discovery URL or client ID — the client secret lives only in Cognito and must be re-supplied to update the provider',
            code: 'VALIDATION_ERROR',
          },
          400,
        )
      }

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

    // Step 3 — Sync to Cognito, but only when a Cognito-stored field changed. A
    // name- or isEnabled-only edit is DB-only and must not touch the registration.
    if (!cognitoRelevantChange) {
      return c.json({ data: toResponse(provider) })
    }

    // Merged state: updated fields take priority over what is already stored.
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
// ---------------------------------------------------------------------------
// PATCH /providers/auth-settings
//
// Updates the cognitoAuthEnabled flag for the tenant.
// Controls whether Cognito built-in email+password login is available.
//
// Request:  { cognitoAuthEnabled: boolean }
// Response: { data: { cognitoAuthEnabled: boolean } } (200)
//           { error, code: VALIDATION_ERROR }         (400)
// ---------------------------------------------------------------------------
const AuthSettingsBody = z.object({
  cognitoAuthEnabled: z.boolean(),
})

ssoHandler.patch(
  '/providers/auth-settings',
  requirePermission(Actions.ManageSsoProviders),
  validator('json', (value, c) => {
    const r = AuthSettingsBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const tenantId = c.get('tenantId')
    const { cognitoAuthEnabled } = c.req.valid('json')

    try {
      await db.tenant.update({
        where: { id: tenantId },
        data: { cognitoAuthEnabled },
      })
      return c.json({ data: { cognitoAuthEnabled } })
    } catch (err) {
      logger.error('PATCH /sso/providers/auth-settings: failed to update', { error: String(err) })
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

ssoHandler.delete('/providers/:id', requirePermission(Actions.ManageSsoProviders), async (c) => {
  const db = c.get('db')
  // `?? ''` mirrors users.ts: adding middleware widens Hono's param typing to
  // string | undefined. Unreachable — the route only matches with an :id.
  const id = c.req.param('id') ?? ''

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

  // Step 2 — Revoke on the app client BEFORE deleting the IdP. Order matters: Cognito
  // validates SupportedIdentityProviders on every client update, so a list naming a
  // provider that no longer exists poisons the client — the next update, for any other
  // provider, fails with "The provider X does not exist for User Pool ...".
  try {
    await removeProviderFromAppClient(
      cognito,
      USER_POOL_ID,
      TENANT_CLIENT_ID,
      existing.cognitoProviderName,
    )
  } catch (clientErr) {
    logger.error('DELETE /providers/:id: failed to revoke provider on app client', {
      error: String(clientErr),
      providerId: id,
      clientId: TENANT_CLIENT_ID,
    })
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }

  // Step 3 — Remove from Cognito
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
      logger.warn('DELETE /providers/:id: Cognito IdP already gone, continuing with DB cleanup', {
        error: String(cognitoErr),
        providerId: id,
      })
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
