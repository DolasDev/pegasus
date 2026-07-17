// ---------------------------------------------------------------------------
// Admin API router — /api/admin/**
//
// All routes in this file require a valid PLATFORM_ADMIN Cognito JWT.
// The adminAuthMiddleware is applied to '*' so no handler in this router
// can ever be reached without authentication, even if new routes are added
// without explicit middleware calls.
//
// This router uses basePrisma (the unscoped singleton from src/db.ts) for any
// database access. It must NEVER use or import the tenant-scoped extension.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { AdminEnv } from '../../types'
import { adminAuthMiddleware } from '../../middleware/admin-auth'
import { adminTenantsRouter } from './tenants'
import { adminWorkflowsRouter } from './workflows'
import { adminTariffsRouter } from './tariffs'

export const adminRouter = new Hono<AdminEnv>()

// Guard every route in the admin namespace unconditionally.
adminRouter.use('*', adminAuthMiddleware)

// Mount bounded-context routers.
adminRouter.route('/tenants', adminTenantsRouter)
adminRouter.route('/workflows', adminWorkflowsRouter)
adminRouter.route('/tariffs', adminTariffsRouter)

// ---------------------------------------------------------------------------
// GET /api/admin/me
//
// Returns the authenticated admin's identity claims extracted from the JWT.
// Used by the admin portal to:
//   1. Confirm the auth chain is working end-to-end after login.
//   2. Display the signed-in admin's email in the navigation bar.
// ---------------------------------------------------------------------------
adminRouter.get('/me', (c) => {
  return c.json({
    data: {
      sub: c.get('adminSub'),
      email: c.get('adminEmail'),
    },
  })
})
