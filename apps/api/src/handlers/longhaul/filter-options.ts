// ---------------------------------------------------------------------------
// Longhaul filter-options handler — shipment filters and move type options
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { OnPremEnv } from '../../types.onprem'
import {
  getFilterOptions,
  getSavedFiltersForUser,
  saveFilter,
  setDefaultFilter,
  deleteFilter,
  getDefaultFilter,
} from '../../repositories/longhaul/filter-options.repository'
import { logger } from '../../lib/logger'

// Date fields are stored as integer offsets from today so that saved filters
// remain meaningful across days. The service layer converts them.
const DATE_FIELDS = ['pack_date', 'load_date', 'delivery_date']

function transformDatesToTimeDiff(query: Record<string, unknown>): Record<string, unknown> {
  const today = new Date(new Date().toDateString()).getTime()
  const filters = { ...((query['filters'] as Record<string, unknown>) ?? {}) }

  for (const field of DATE_FIELDS) {
    const range = filters[field]
    if (Array.isArray(range)) {
      filters[field] = range.map((d: unknown) => {
        if (d == null) return d
        const daysDiff = Math.round(
          (new Date(d as string).getTime() - today) / (1000 * 60 * 60 * 24),
        )
        return daysDiff
      })
    }
  }

  return { ...query, filters }
}

function transformTimeDiffToDate(query: Record<string, unknown>): Record<string, unknown> {
  const filters = { ...((query['filters'] as Record<string, unknown>) ?? {}) }

  for (const field of DATE_FIELDS) {
    const range = filters[field]
    if (Array.isArray(range)) {
      filters[field] = range.map((offset: unknown) => {
        if (offset == null || isNaN(Number(offset))) return offset
        const today = new Date()
        today.setDate(today.getDate() + Number(offset))
        const dd = String(today.getDate()).padStart(2, '0')
        const mm = String(today.getMonth() + 1).padStart(2, '0')
        const yyyy = today.getFullYear()
        return `${yyyy}-${mm}-${dd}`
      })
    }
  }

  return { ...query, filters }
}

const SaveFilterBody = z.object({
  name: z.string().min(1),
  user_code: z.string().or(z.number()),
  query: z.record(z.string(), z.unknown()),
  is_public: z.boolean().optional(),
  is_default: z.boolean().optional(),
})

const SetDefaultFilterBody = z.object({
  filter_id: z.number(),
})

export const filterOptionsRouter = new Hono<OnPremEnv>()

filterOptionsRouter.get('/filter-options', async (c) => {
  try {
    const db = c.get('longhaulDb')
    const data = await getFilterOptions(db)
    return c.json({ data })
  } catch (err) {
    logger.error('fetchFilterOptions failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch filter options',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
})

filterOptionsRouter.get('/shipment-filters', async (c) => {
  const user = c.get('longhaulUser')
  if (!user) {
    return c.json(
      {
        error: 'User not found',
        code: 'LONGHAUL_USER_NOT_FOUND',
        correlationId: c.get('correlationId'),
      },
      403,
    )
  }

  try {
    const db = c.get('longhaulDb')
    const rawFilters = await getSavedFiltersForUser(db, user.code)
    const data = rawFilters.map((f) => {
      try {
        const parsed = JSON.parse(f.query as string)
        return { ...f, query: JSON.stringify(transformTimeDiffToDate(parsed)) }
      } catch {
        return f
      }
    })
    return c.json({ data })
  } catch (err) {
    logger.error('fetchSavedShipmentFilters failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch saved filters',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
})

filterOptionsRouter.post(
  '/shipment-filters',
  validator('json', (value, c) => {
    const r = SaveFilterBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    try {
      const db = c.get('longhaulDb')
      const body = c.req.valid('json')
      const transformedQuery = transformDatesToTimeDiff(body.query)

      const filter = await saveFilter(db, {
        name: body.name.trim(),
        owner_code: body.user_code,
        query: JSON.stringify(transformedQuery),
        is_public: body.is_public ?? false,
      })

      if (body.is_default && filter?.filter_id) {
        await setDefaultFilter(db, filter.filter_id as number, body.user_code)
      }

      return c.json({ data: filter }, 201)
    } catch (err) {
      logger.error('saveShipmentsFilter failed', { error: String(err) })
      return c.json(
        {
          error: 'Failed to save filter',
          code: 'INTERNAL_ERROR',
          correlationId: c.get('correlationId'),
        },
        500,
      )
    }
  },
)

filterOptionsRouter.get('/shipment-filters/default', async (c) => {
  const user = c.get('longhaulUser')
  if (!user) {
    return c.json(
      {
        error: 'User not found',
        code: 'LONGHAUL_USER_NOT_FOUND',
        correlationId: c.get('correlationId'),
      },
      403,
    )
  }

  try {
    const db = c.get('longhaulDb')
    const filter = await getDefaultFilter(db, user.code)
    if (!filter) return c.json({ data: null })

    try {
      const parsed = JSON.parse(filter.query as string)
      return c.json({ data: { ...filter, query: JSON.stringify(transformTimeDiffToDate(parsed)) } })
    } catch {
      return c.json({ data: filter })
    }
  } catch (err) {
    logger.error('fetchShipmentDefaultFilterForUser failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to fetch default filter',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
})

filterOptionsRouter.put(
  '/shipment-filters/default',
  validator('json', (value, c) => {
    const r = SetDefaultFilterBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const user = c.get('longhaulUser')
    if (!user) {
      return c.json(
        {
          error: 'User not found',
          code: 'LONGHAUL_USER_NOT_FOUND',
          correlationId: c.get('correlationId'),
        },
        403,
      )
    }

    try {
      const db = c.get('longhaulDb')
      const body = c.req.valid('json')
      await setDefaultFilter(db, body.filter_id, user.code)
      return c.json({ data: { success: true } })
    } catch (err) {
      logger.error('setDefaultShipmentFilter failed', { error: String(err) })
      return c.json(
        {
          error: 'Failed to set default filter',
          code: 'INTERNAL_ERROR',
          correlationId: c.get('correlationId'),
        },
        500,
      )
    }
  },
)

filterOptionsRouter.delete('/shipment-filters/:id', async (c) => {
  const filterId = parseInt(c.req.param('id'), 10)
  if (isNaN(filterId)) {
    return c.json(
      {
        error: 'Invalid filter id',
        code: 'VALIDATION_ERROR',
        correlationId: c.get('correlationId'),
      },
      400,
    )
  }

  try {
    const db = c.get('longhaulDb')
    await deleteFilter(db, filterId)
    return c.json({ data: { success: true } })
  } catch (err) {
    logger.error('deleteShipmentFilter failed', { error: String(err) })
    return c.json(
      {
        error: 'Failed to delete filter',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
})
