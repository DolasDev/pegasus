import { Hono } from 'hono'
import type { AppEnv } from '../../types'
import type { EntityConfig } from './types'
import * as repo from '../../repositories/pegii/generic.repository'
import { logger } from '../../lib/logger'

export function createEntityRouter(config: EntityConfig): Hono<AppEnv> {
  const router = new Hono<AppEnv>()

  router.get('/ids', async (c) => {
    const pool = c.get('mssqlPool')
    const q = c.req.query('q') ?? ''
    logger.info('pegii allIds', { entity: config.slug, q })
    const ids = await repo.allIds(pool, config, q)
    return c.json({ data: ids })
  })

  router.get('/code/:code', async (c) => {
    const pool = c.get('mssqlPool')
    const code = c.req.param('code')
    logger.info('pegii readByCode', { entity: config.slug, code })
    const row = await repo.readByCode(pool, config, code)
    if (!row) {
      logger.warn('pegii readByCode not found', { entity: config.slug, code })
      return c.json(
        { error: 'Not found', code: 'NOT_FOUND', correlationId: c.get('correlationId') },
        404,
      )
    }
    return c.json({ data: row })
  })

  router.get('/:id', async (c) => {
    const pool = c.get('mssqlPool')
    const rawId = c.req.param('id')
    const id = config.idType === 'integer' ? Number(rawId) : rawId
    if (config.idType === 'integer' && isNaN(id as number)) {
      return c.json(
        { error: 'Invalid ID', code: 'VALIDATION_ERROR', correlationId: c.get('correlationId') },
        400,
      )
    }
    logger.info('pegii readById', { entity: config.slug, id })
    const row = await repo.readById(pool, config, id)
    if (!row) {
      logger.warn('pegii readById not found', { entity: config.slug, id })
      return c.json(
        { error: 'Not found', code: 'NOT_FOUND', correlationId: c.get('correlationId') },
        404,
      )
    }
    return c.json({ data: row })
  })

  router.get('/', async (c) => {
    const pool = c.get('mssqlPool')
    const q = c.req.query('q') ?? ''
    const limit = Math.min(Number(c.req.query('limit') ?? '1000'), 1000)
    const offset = Number(c.req.query('offset') ?? '0')
    logger.info('pegii readList', { entity: config.slug, q, limit, offset })
    const rows = await repo.readList(pool, config, q, limit, offset)
    return c.json({ data: rows, meta: { count: rows.length, limit, offset } })
  })

  router.post('/', async (c) => {
    const pool = c.get('mssqlPool')
    const body = await c.req.json<Record<string, unknown>>()
    logger.info('pegii create', { entity: config.slug })
    const row = await repo.write(pool, config, body)
    return c.json({ data: row }, 201)
  })

  router.put('/:id', async (c) => {
    const pool = c.get('mssqlPool')
    const rawId = c.req.param('id')
    const id = config.idType === 'integer' ? Number(rawId) : rawId
    if (config.idType === 'integer' && isNaN(id as number)) {
      return c.json(
        { error: 'Invalid ID', code: 'VALIDATION_ERROR', correlationId: c.get('correlationId') },
        400,
      )
    }
    logger.info('pegii update', { entity: config.slug, id })
    const body = await c.req.json<Record<string, unknown>>()
    const row = await repo.write(pool, config, body, id)
    return c.json({ data: row })
  })

  if (config.customRoutes) {
    config.customRoutes(router)
  }

  return router
}

export function createDomainRouter(domainSlug: string, entities: EntityConfig[]): Hono<AppEnv> {
  const router = new Hono<AppEnv>()
  for (const entity of entities) {
    router.route(`/${entity.slug}`, createEntityRouter(entity))
  }
  return router
}
