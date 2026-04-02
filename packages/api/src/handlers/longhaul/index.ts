// ---------------------------------------------------------------------------
// Longhaul router — mounts all longhaul sub-routers behind longhaulUserMiddleware
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { AppEnv } from '../../types'
import { longhaulUserMiddleware } from '../../middleware/longhaul-user'
import { tripsRouter } from './trips'
import { shipmentsRouter } from './shipments'
import { activitiesRouter } from './activities'
import { filterOptionsRouter } from './filter-options'
import { referenceRouter } from './reference'
import { remoteRouter } from './remote'

const longhaulRouter = new Hono<AppEnv>()

// All longhaul routes require authentication via the longhaul user middleware.
// The middleware handles both SKIP_AUTH (Windows user header) and M2M (API key) modes.
longhaulRouter.use('*', longhaulUserMiddleware)

longhaulRouter.route('/', tripsRouter)
longhaulRouter.route('/', shipmentsRouter)
longhaulRouter.route('/', activitiesRouter)
longhaulRouter.route('/', filterOptionsRouter)
longhaulRouter.route('/', referenceRouter)
longhaulRouter.route('/', remoteRouter)

export { longhaulRouter }
