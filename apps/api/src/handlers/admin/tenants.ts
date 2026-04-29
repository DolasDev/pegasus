// ---------------------------------------------------------------------------
// Admin tenant handler — /api/admin/tenants/**
//
// All routes here are reachable only after adminAuthMiddleware has run (it is
// applied unconditionally in admin/index.ts). Database access uses the raw
// basePrisma singleton — never the tenant-scoped extension.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import type { AdminEnv } from '../../types'
import { db } from '../../db'
import { writeAuditLog } from './audit'
import { provisionCognitoUser } from './cognito'
import { logger } from '../../lib/logger'
import { adminTenantUsersRouter } from './tenant-users'
import { adminVpnRouter } from './vpn'

const TenantStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'OFFBOARDED'])

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/** Validates a DNS domain label: lowercase letters, digits, optional hyphens. */
const DomainSchema = z
  .string()
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, {
    message: 'Each domain must be a valid DNS domain (e.g. acme.com)',
  })

const CreateTenantBody = z.object({
  /** Display name of the moving company. */
  name: z.string().min(1).max(255),
  /**
   * URL-safe subdomain identifier (e.g. "acme" for acme.pegasusapp.com).
   * Must be 3–63 lowercase alphanumeric characters, optionally with hyphens.
   * Must start with a letter and end with a letter or digit.
   */
  slug: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/, {
      message:
        'Slug must be 3–63 lowercase alphanumeric characters, start with a letter, and may contain hyphens',
    }),
  plan: z.enum(['STARTER', 'GROWTH', 'ENTERPRISE']).optional(),
  contactName: z.string().min(1).max(255).optional(),
  contactEmail: z.string().email().optional(),
  /**
   * Email domains belonging to this tenant (e.g. ["acme.com"]).
   * At least one domain is required so the SSO login flow can resolve the
   * tenant from the user's email address.
   */
  emailDomains: z.array(DomainSchema).min(1),
  /**
   * Email address for the initial tenant administrator account.
   * A Cognito user is created with FORCE_CHANGE_PASSWORD status and an invite
   * email is sent so the administrator can set their password and configure SSO.
   */
  adminEmail: z.string().email(),
})

const PatchTenantBody = z.object({
  /** Updated display name. */
  name: z.string().min(1).max(255).optional(),
  /** Subscription plan tier. */
  plan: z.enum(['STARTER', 'GROWTH', 'ENTERPRISE']).optional(),
  /** Primary contact name. Pass null to clear. */
  contactName: z.string().min(1).max(255).nullable().optional(),
  /** Primary contact email. Pass null to clear. */
  contactEmail: z.string().email().nullable().optional(),
  /**
   * Email domains belonging to this tenant. Replaces the full array.
   * Must contain at least one valid domain if provided.
   */
  emailDomains: z.array(DomainSchema).min(1).optional(),
  /** When true, Cognito built-in email+password login is available. */
  cognitoAuthEnabled: z.boolean().optional(),
})

// ---------------------------------------------------------------------------
// Helper — serialise a Prisma row into a plain JSON snapshot for audit logs.
// Date fields are converted to ISO strings by JSON.stringify so they survive
// round-trips through the Json column type.
// ---------------------------------------------------------------------------
function toSnapshot(row: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue
}

// Fields returned by both list and detail views.
const LIST_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  plan: true,
  contactName: true,
  contactEmail: true,
  emailDomains: true,
  cognitoAuthEnabled: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const

// Detail view uses the same fields as the list view for tenants.
// SSO providers are managed via the dedicated /api/v1/sso/providers routes.
const DETAIL_SELECT = LIST_SELECT

export const adminTenantsRouter = new Hono<AdminEnv>()

// ---------------------------------------------------------------------------
// GET /api/admin/tenants
//
// Returns a paginated list of tenants.
//
// Query parameters:
//   status            Filter by exact TenantStatus (ACTIVE | SUSPENDED | OFFBOARDED).
//                     Mutually exclusive with includeOffboarded.
//   includeOffboarded If "true", includes OFFBOARDED tenants in an unfiltered result.
//                     Default: false (OFFBOARDED tenants are excluded by default).
//   limit             Page size (default 50, max 100).
//   offset            Page offset (default 0).
//
// Response: { data: Tenant[], meta: { total, count, limit, offset } }
// ---------------------------------------------------------------------------
adminTenantsRouter.get('/', async (c) => {
  const rawStatus = c.req.query('status')
  const includeOffboarded = c.req.query('includeOffboarded') === 'true'
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 100)
  const offset = Number(c.req.query('offset') ?? '0')

  if (rawStatus !== undefined) {
    const parsed = TenantStatusSchema.safeParse(rawStatus)
    if (!parsed.success) {
      return c.json({ error: 'Invalid status value', code: 'VALIDATION_ERROR' }, 400)
    }
  }

  // Build where clause. Explicit branching ensures exactOptionalPropertyTypes
  // is satisfied without casting.
  let where: Prisma.TenantWhereInput
  if (rawStatus !== undefined) {
    // Safe: already validated above.
    where = { status: rawStatus as 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDED' }
  } else if (includeOffboarded) {
    where = {}
  } else {
    // Default: hide OFFBOARDED tenants from the admin list.
    where = { NOT: { status: 'OFFBOARDED' } }
  }

  try {
    const [data, total] = await Promise.all([
      db.tenant.findMany({
        where,
        select: LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      db.tenant.count({ where }),
    ])

    return c.json({ data, meta: { total, count: data.length, limit, offset } })
  } catch {
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

// ---------------------------------------------------------------------------
// POST /api/admin/tenants
//
// Creates a new tenant account. Slug uniqueness is enforced at the database
// level — a 409 is returned if the slug is already taken.
//
// The creation and its audit log entry are committed in a single Prisma
// interactive transaction so they are always consistent.
//
// Response: 201 { data: Tenant } — includes emailDomains; see LIST_SELECT for all fields.
// ---------------------------------------------------------------------------
adminTenantsRouter.post(
  '/',
  validator('json', (value, c) => {
    const r = CreateTenantBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const body = c.req.valid('json')
    const adminSub = c.get('adminSub')
    const adminEmail = c.get('adminEmail')
    const ipAddress = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip')
    const userAgent = c.req.header('user-agent')

    // Provision the Cognito admin user before touching the database.
    // This is idempotent (UsernameExistsException is silently ignored), so
    // retrying after a DB failure is safe. If Cognito fails, we abort early
    // so no orphaned DB record is created.
    try {
      await provisionCognitoUser(body.adminEmail, {
        // The tenant row is created in the transaction below, so its UUID is
        // not yet known. The CustomMessage Lambda renders from name + slug
        // and uses tenantId only for logging.
        tenantId: '',
        tenantName: body.name,
        tenantSlug: body.slug,
      })
    } catch (err) {
      logger.error('Failed to provision Cognito admin user', { error: String(err) })
      return c.json(
        {
          error: 'Failed to create the administrator account. Please try again.',
          code: 'COGNITO_ERROR',
        },
        500,
      )
    }

    try {
      const tenant = await db.$transaction(async (tx) => {
        const created = await tx.tenant.create({
          data: {
            name: body.name,
            slug: body.slug,
            emailDomains: body.emailDomains,
            ...(body.plan !== undefined ? { plan: body.plan } : {}),
            ...(body.contactName !== undefined ? { contactName: body.contactName } : {}),
            ...(body.contactEmail !== undefined ? { contactEmail: body.contactEmail } : {}),
          },
          select: DETAIL_SELECT,
        })

        // Create the initial admin TenantUser record so the first login
        // succeeds and the user receives the tenant_admin role.
        await tx.tenantUser.create({
          data: {
            tenantId: created.id,
            email: body.adminEmail.toLowerCase(),
            role: 'ADMIN',
            status: 'PENDING',
          },
        })

        await writeAuditLog(
          tx,
          adminSub,
          adminEmail,
          'CREATE_TENANT',
          'TENANT',
          created.id,
          null,
          created as unknown as Prisma.InputJsonValue,
          ipAddress,
          userAgent,
        )

        return created
      })

      return c.json({ data: tenant }, 201)
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return c.json({ error: 'A tenant with that slug already exists', code: 'CONFLICT' }, 409)
      }
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

// ---------------------------------------------------------------------------
// PATCH /api/admin/tenants/:id
//
// Updates editable tenant fields. Slug is intentionally excluded — it is
// immutable after creation because changing it would break existing subdomains.
// Status changes go through the explicit /suspend and /reactivate actions.
//
// All non-provided fields are left unchanged (partial update semantics).
// An empty body is accepted and treated as a no-op (Prisma still bumps
// updatedAt which is recorded in the audit log).
//
// Response: { data: Tenant } with the updated record (DETAIL_SELECT shape).
// ---------------------------------------------------------------------------
adminTenantsRouter.patch(
  '/:id',
  validator('json', (value, c) => {
    const r = PatchTenantBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const id = c.req.param('id')
    const body = c.req.valid('json')
    const adminSub = c.get('adminSub')
    const adminEmail = c.get('adminEmail')
    const ipAddress = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip')
    const userAgent = c.req.header('user-agent')

    try {
      const result = await db.$transaction(async (tx) => {
        // Read current state inside the transaction for a consistent "before" snapshot.
        const current = await tx.tenant.findUnique({ where: { id }, select: DETAIL_SELECT })
        if (!current) return null

        const updated = await tx.tenant.update({
          where: { id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.plan !== undefined ? { plan: body.plan } : {}),
            // null clears the nullable fields; undefined is a no-op.
            ...(body.contactName !== undefined ? { contactName: body.contactName } : {}),
            ...(body.contactEmail !== undefined ? { contactEmail: body.contactEmail } : {}),
            // emailDomains replaces the whole array when provided.
            ...(body.emailDomains !== undefined ? { emailDomains: body.emailDomains } : {}),
            ...(body.cognitoAuthEnabled !== undefined
              ? { cognitoAuthEnabled: body.cognitoAuthEnabled }
              : {}),
          },
          select: DETAIL_SELECT,
        })

        await writeAuditLog(
          tx,
          adminSub,
          adminEmail,
          'UPDATE_TENANT',
          'TENANT',
          id,
          toSnapshot(current),
          toSnapshot(updated),
          ipAddress,
          userAgent,
        )

        return updated
      })

      if (!result) return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
      return c.json({ data: result })
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

// ---------------------------------------------------------------------------
// GET /api/admin/tenants/:id
//
// Returns a single tenant record including emailDomains.
// Returns 404 for unknown IDs including offboarded tenants (admins must use
// ?status=OFFBOARDED on the list endpoint to find them).
// ---------------------------------------------------------------------------
adminTenantsRouter.get('/:id', async (c) => {
  const id = c.req.param('id')

  try {
    const data = await db.tenant.findUnique({
      where: { id },
      select: DETAIL_SELECT,
    })

    if (!data) {
      return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
    }

    return c.json({ data })
  } catch {
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

// ---------------------------------------------------------------------------
// POST /api/admin/tenants/:id/suspend
//
// Suspends an ACTIVE tenant. The tenant middleware will return 403 for all
// requests from that tenant's subdomain until reactivated.
//
// Valid transition: ACTIVE → SUSPENDED.
// Returns 422 INVALID_STATE if the tenant is already SUSPENDED or OFFBOARDED.
// ---------------------------------------------------------------------------
adminTenantsRouter.post('/:id/suspend', async (c) => {
  const id = c.req.param('id')
  const adminSub = c.get('adminSub')
  const adminEmail = c.get('adminEmail')
  const ipAddress = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip')
  const userAgent = c.req.header('user-agent')

  // Pre-check: read current state before opening a write transaction.
  const current = await db.tenant.findUnique({ where: { id }, select: DETAIL_SELECT })
  if (!current) return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
  if (current.status !== 'ACTIVE') {
    return c.json(
      { error: `Cannot suspend a tenant with status ${current.status}`, code: 'INVALID_STATE' },
      422,
    )
  }

  try {
    const updated = await db.$transaction(async (tx) => {
      const t = await tx.tenant.update({
        where: { id },
        data: { status: 'SUSPENDED' },
        select: DETAIL_SELECT,
      })
      await writeAuditLog(
        tx,
        adminSub,
        adminEmail,
        'SUSPEND_TENANT',
        'TENANT',
        id,
        toSnapshot(current),
        toSnapshot(t),
        ipAddress,
        userAgent,
      )
      return t
    })

    return c.json({ data: updated })
  } catch {
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

// ---------------------------------------------------------------------------
// POST /api/admin/tenants/:id/reactivate
//
// Reactivates a SUSPENDED tenant. The tenant middleware resumes normal routing
// for that tenant's subdomain.
//
// Valid transition: SUSPENDED → ACTIVE.
// Returns 422 INVALID_STATE if the tenant is already ACTIVE or OFFBOARDED.
// ---------------------------------------------------------------------------
adminTenantsRouter.post('/:id/reactivate', async (c) => {
  const id = c.req.param('id')
  const adminSub = c.get('adminSub')
  const adminEmail = c.get('adminEmail')
  const ipAddress = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip')
  const userAgent = c.req.header('user-agent')

  const current = await db.tenant.findUnique({ where: { id }, select: DETAIL_SELECT })
  if (!current) return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
  if (current.status !== 'SUSPENDED') {
    return c.json(
      {
        error: `Cannot reactivate a tenant with status ${current.status}`,
        code: 'INVALID_STATE',
      },
      422,
    )
  }

  try {
    const updated = await db.$transaction(async (tx) => {
      const t = await tx.tenant.update({
        where: { id },
        data: { status: 'ACTIVE' },
        select: DETAIL_SELECT,
      })
      await writeAuditLog(
        tx,
        adminSub,
        adminEmail,
        'REACTIVATE_TENANT',
        'TENANT',
        id,
        toSnapshot(current),
        toSnapshot(t),
        ipAddress,
        userAgent,
      )
      return t
    })

    return c.json({ data: updated })
  } catch {
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

// ---------------------------------------------------------------------------
// POST /api/admin/tenants/:id/reactivate
//
// Permanently offboards a tenant. Sets status = OFFBOARDED and records the
// offboard timestamp in deletedAt. Data is retained (soft delete).
//
// Valid transitions: ACTIVE → OFFBOARDED, SUSPENDED → OFFBOARDED.
// Returns 422 INVALID_STATE if the tenant is already OFFBOARDED.
// This action is irreversible through the API — there is no re-offboard route.
// ---------------------------------------------------------------------------
adminTenantsRouter.post('/:id/offboard', async (c) => {
  const id = c.req.param('id')
  const adminSub = c.get('adminSub')
  const adminEmail = c.get('adminEmail')
  const ipAddress = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip')
  const userAgent = c.req.header('user-agent')

  const current = await db.tenant.findUnique({ where: { id }, select: DETAIL_SELECT })
  if (!current) return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
  if (current.status === 'OFFBOARDED') {
    return c.json({ error: 'Tenant is already offboarded', code: 'INVALID_STATE' }, 422)
  }

  try {
    const updated = await db.$transaction(async (tx) => {
      const t = await tx.tenant.update({
        where: { id },
        data: { status: 'OFFBOARDED', deletedAt: new Date() },
        select: DETAIL_SELECT,
      })
      await writeAuditLog(
        tx,
        adminSub,
        adminEmail,
        'OFFBOARD_TENANT',
        'TENANT',
        id,
        toSnapshot(current),
        toSnapshot(t),
        ipAddress,
        userAgent,
      )
      return t
    })

    return c.json({ data: updated })
  } catch {
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Mount tenant-user sub-router
//
// Routes: GET|POST /api/admin/tenants/:tenantId/users
//         PATCH|DELETE /api/admin/tenants/:tenantId/users/:userId
// ---------------------------------------------------------------------------
adminTenantsRouter.route('/:tenantId/users', adminTenantUsersRouter)

// ---------------------------------------------------------------------------
// Mount tenant VPN sub-router
//
// Routes: POST|GET|DELETE /api/admin/tenants/:tenantId/vpn
//         GET             /api/admin/tenants/:tenantId/vpn/status
//         POST            /api/admin/tenants/:tenantId/vpn/rotate
//         POST            /api/admin/tenants/:tenantId/vpn/suspend
//         POST            /api/admin/tenants/:tenantId/vpn/resume
// ---------------------------------------------------------------------------
adminTenantsRouter.route('/:tenantId/vpn', adminVpnRouter)
