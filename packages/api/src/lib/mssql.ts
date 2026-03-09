import sql from 'mssql'
import { logger } from './logger'

const pools = new Map<string, sql.ConnectionPool>()

export async function getPool(connectionString: string): Promise<sql.ConnectionPool> {
  const existing = pools.get(connectionString)
  if (existing?.connected) return existing

  logger.info('Opening mssql connection pool')
  const pool = new sql.ConnectionPool(connectionString)
  pool.on('error', (err) => {
    logger.error('mssql pool error', { error: err.message })
    pools.delete(connectionString)
  })
  await pool.connect()
  pools.set(connectionString, pool)
  return pool
}

export async function closeAllPools(): Promise<void> {
  for (const [key, pool] of pools) {
    await pool.close()
    pools.delete(key)
  }
}

export { sql }
