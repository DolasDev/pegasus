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

const TenantStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'OFFBOARDED'])

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

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
   * SSO provider configuration stub. Accepts any JSON object or null.
   * The field is reserved for future per-tenant OIDC/SAML configuration.
   */
  ssoProviderConfig: z.record(z.unknown()).nullable().optional(),
})

// ---------------------------------------------------------------------------
// Helper — serialise a Prisma row into a plain JSON snapshot for audit logs.
// Date fields are converted to ISO strings by JSON.stringify so they survive
// round-trips through the Json column type.
// ---------------------------------------------------------------------------
function toSnapshot(row: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue
}

// Fields projected by the list view — omits ssoProviderConfig (large JSON blob).
const LIST_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  plan: true,
  contactName: true,
  contactEmail: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const

// Fields projected by the detail view — adds ssoProviderConfig for the
// SSO stub UI and the full admin edit form.
const DETAIL_SELECT = {
  ...LIST_SELECT,
  ssoProviderConfig: true,
} as const

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
// Response: 201 { data: Tenant } — same shape as GET /:id (includes ssoProviderConfig).
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

    try {
      const tenant = await db.$transaction(async (tx) => {
        const created = await tx.tenant.create({
          data: {
            name: body.name,
            slug: body.slug,
            ...(body.plan !== undefined ? { plan: body.plan } : {}),
            ...(body.contactName !== undefined ? { contactName: body.contactName } : {}),
            ...(body.contactEmail !== undefined ? { contactEmail: body.contactEmail } : {}),
          },
          select: DETAIL_SELECT,
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
            ...(body.ssoProviderConfig !== undefined
              ? {
                  ssoProviderConfig:
                    body.ssoProviderConfig !== null
                      ? (body.ssoProviderConfig as Prisma.InputJsonValue)
                      : Prisma.JsonNull,
                }
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
// Returns a single tenant including ssoProviderConfig.
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
// POST /api/admin/tenants/:id/offboard
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
