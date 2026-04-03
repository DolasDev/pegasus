import type sql from 'mssql'
import type { EntityConfig } from '../../handlers/pegii/types'
import { createWhereGivenFn, queryGiven } from './query-builder'
import { getColumns, mapRow } from './column-utils'
import { logger } from '../../lib/logger'

export async function allIds(
  pool: sql.ConnectionPool,
  config: EntityConfig,
  searchCriteria: string,
): Promise<number[]> {
  const whereGivenFn = createWhereGivenFn(config.searchKeywords, config.freeTextColumns)
  const { sql: query, params } = queryGiven(
    config.tableName,
    config.idField,
    searchCriteria,
    whereGivenFn,
    config.orderBy,
  )
  logger.debug('allIds query', { sql: query })
  const request = pool.request()
  for (const [key, value] of Object.entries(params)) request.input(key, value)
  ;(request as unknown as { timeout: number }).timeout = 30_000
  const result = await request.query(query)
  return result.recordset.map((row: Record<string, unknown>) => Number(row[config.idField]))
}

export async function readById(
  pool: sql.ConnectionPool,
  config: EntityConfig,
  id: number | string,
): Promise<Record<string, unknown> | null> {
  const query = `SELECT * FROM ${config.tableName} WHERE ${config.idField} = @idParam`
  logger.debug('readById query', { query })
  const request = pool.request()
  request.input('idParam', config.idType === 'integer' ? Number(id) : String(id))
  ;(request as unknown as { timeout: number }).timeout = 30_000
  const result = await request.query(query)
  if (result.recordset.length === 0) return null
  return mapRow(result.recordset[0] as Record<string, unknown>)
}

export async function readByCode(
  pool: sql.ConnectionPool,
  config: EntityConfig,
  code: string,
): Promise<Record<string, unknown> | null> {
  const query = `SELECT * FROM ${config.tableName} WHERE ${config.codeField} = @codeParam`
  logger.debug('readByCode query', { query })
  const request = pool.request()
  request.input('codeParam', code)
  ;(request as unknown as { timeout: number }).timeout = 30_000
  const result = await request.query(query)
  if (result.recordset.length === 0) return null
  return mapRow(result.recordset[0] as Record<string, unknown>)
}

export async function readList(
  pool: sql.ConnectionPool,
  config: EntityConfig,
  searchCriteria: string,
  limit = 1000,
  offset = 0,
): Promise<Record<string, unknown>[]> {
  const whereGivenFn = createWhereGivenFn(config.searchKeywords, config.freeTextColumns)
  const fields = config.listFields ?? '*'
  const { sql: query, params } = queryGiven(
    config.tableName,
    fields,
    searchCriteria,
    whereGivenFn,
    config.orderBy,
  )
  let paginatedQuery = query

  if (offset > 0) {
    paginatedQuery = paginatedQuery.replace(/SELECT TOP 1000/i, `SELECT`)
    paginatedQuery += ` OFFSET ${offset} ROWS FETCH NEXT ${Math.min(limit, 1000)} ROWS ONLY`
  }

  logger.debug('readList query', { query: paginatedQuery })
  const request = pool.request()
  for (const [key, value] of Object.entries(params)) request.input(key, value)
  ;(request as unknown as { timeout: number }).timeout = 30_000
  const result = await request.query(paginatedQuery)
  return result.recordset.map((row: Record<string, unknown>) => mapRow(row))
}

export async function write(
  pool: sql.ConnectionPool,
  config: EntityConfig,
  data: Record<string, unknown>,
  id?: number | string,
): Promise<Record<string, unknown>> {
  const columns = await getColumns(pool, config.tableName)
  const columnNames = new Set(columns.map((c) => c.name.toLowerCase()))

  const isUpdate = id !== undefined && id !== null && (config.idType === 'string' || Number(id) > 0)

  if (isUpdate) {
    const setClauses: string[] = []
    const request = pool.request()
    let paramIdx = 0

    for (const [key, value] of Object.entries(data)) {
      if (!columnNames.has(key.toLowerCase())) continue
      if (key.toLowerCase() === config.idField.toLowerCase()) continue
      const paramName = `p${paramIdx++}`
      setClauses.push(`[${key}] = @${paramName}`)
      request.input(paramName, value ?? null)
    }

    if (setClauses.length === 0) {
      const existing = await readById(pool, config, id)
      if (!existing) throw new Error(`Record not found: ${id}`)
      return existing
    }

    const idParamName = `pId`
    request.input(idParamName, id)
    const updateSql = `UPDATE ${config.tableName} SET ${setClauses.join(', ')} WHERE ${config.idField} = @${idParamName}`
    logger.debug('write update', { sql: updateSql })
    await request.query(updateSql)

    return (await readById(pool, config, id))!
  } else {
    const insertCols: string[] = []
    const insertParams: string[] = []
    const request = pool.request()
    let paramIdx = 0

    for (const [key, value] of Object.entries(data)) {
      if (!columnNames.has(key.toLowerCase())) continue
      if (key.toLowerCase() === config.idField.toLowerCase() && config.idType === 'integer')
        continue
      const paramName = `p${paramIdx++}`
      insertCols.push(`[${key}]`)
      insertParams.push(`@${paramName}`)
      request.input(paramName, value ?? null)
    }

    const identityClause = config.idType === 'integer' ? '; SELECT SCOPE_IDENTITY() AS id' : ''
    const insertSql = `INSERT INTO ${config.tableName} (${insertCols.join(', ')}) VALUES (${insertParams.join(', ')})${identityClause}`
    logger.debug('write insert', { sql: insertSql })
    const result = await request.query(insertSql)

    let newId: number | string
    if (config.idType === 'integer') {
      newId = Number(result.recordset?.[0]?.id)
    } else {
      newId = String(data[config.idField] ?? data[config.codeField] ?? '')
    }

    return (await readById(pool, config, newId))!
  }
}
