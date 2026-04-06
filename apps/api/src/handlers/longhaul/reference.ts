// ---------------------------------------------------------------------------
// Longhaul reference data handler — drivers, states, zones, users, version,
// planners, dispatchers, activity types
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { OnPremEnv } from '../../types.onprem'
import { getLonghaulDb } from '../../lib/longhaul-db'
import {
  getDrivers,
  getStates,
  getZones,
  getPlanners,
  getDispatchers,
  getVersion,
  getActivityTypes,
} from '../../repositories/longhaul/reference.repository'
import { logger } from '../../lib/logger'

export const referenceRouter = new Hono<OnPremEnv>()

referenceRouter.get('/drivers', async (c) => {
  try {
    const db = getLonghaulDb()
    const data = await getDrivers(db)
    return c.json({ data })
  } catch (err) {
    logger.error('fetchDrivers failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch drivers',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
})

referenceRouter.get('/users/me', async (c) => {
  const user = c.get('longhaulUser')
  return c.json({ data: user ?? null })
})

referenceRouter.get('/version', async (c) => {
  try {
    const db = getLonghaulDb()
    const data = await getVersion(db)
    return c.json({ data })
  } catch (err) {
    logger.error('fetchVersion failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch version',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
})

referenceRouter.get('/states', async (c) => {
  try {
    const db = getLonghaulDb()
    const data = await getStates(db)
    return c.json({ data })
  } catch (err) {
    logger.error('fetchStates failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch states',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
})

referenceRouter.get('/zones', async (c) => {
  try {
    const db = getLonghaulDb()
    const data = await getZones(db)
    return c.json({ data })
  } catch (err) {
    logger.error('fetchZones failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch zones',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
})

referenceRouter.get('/planners', async (c) => {
  try {
    const db = getLonghaulDb()
    const data = await getPlanners(db)
    return c.json({ data })
  } catch (err) {
    logger.error('fetchPlanners failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch planners',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
})

referenceRouter.get('/dispatchers', async (c) => {
  try {
    const db = getLonghaulDb()
    const data = await getDispatchers(db)
    return c.json({ data })
  } catch (err) {
    logger.error('fetchDispatchers failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch dispatchers',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
})

referenceRouter.get('/activity-types', async (c) => {
  try {
    const db = getLonghaulDb()
    const data = await getActivityTypes(db)
    return c.json({ data })
  } catch (err) {
    logger.error('fetchActivityTypes failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch activity types',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
})
