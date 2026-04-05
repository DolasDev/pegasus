import type sql from 'mssql'
import type { ColumnDef } from '../../handlers/pegii/types'

const schemaCache = new Map<string, Map<string, ColumnDef[]>>()

export async function getColumns(
  pool: sql.ConnectionPool,
  tableName: string,
): Promise<ColumnDef[]> {
  const dbName = (pool as unknown as { config: { database?: string } }).config.database ?? ''
  let tableMap = schemaCache.get(dbName)
  if (tableMap?.has(tableName)) return tableMap.get(tableName)!

  const request = pool.request()
  request.input('tableName', tableName)
  const result = await request.query<{
    COLUMN_NAME: string
    DATA_TYPE: string
    IS_NULLABLE: string
    CHARACTER_MAXIMUM_LENGTH: number | null
  }>(
    `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_NAME = @tableName
     ORDER BY ORDINAL_POSITION`,
  )

  const columns: ColumnDef[] = result.recordset.map((row) => ({
    name: row.COLUMN_NAME,
    dataType: row.DATA_TYPE,
    isNullable: row.IS_NULLABLE === 'YES',
    maxLength: row.CHARACTER_MAXIMUM_LENGTH,
  }))

  if (!tableMap) {
    tableMap = new Map()
    schemaCache.set(dbName, tableMap)
  }
  tableMap.set(tableName, columns)
  return columns
}

export function clearSchemaCache(): void {
  schemaCache.clear()
}

export function mapRow(row: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      mapped[key] = value.toISOString()
    } else if (value === null || value === undefined) {
      mapped[key] = null
    } else {
      mapped[key] = value
    }
  }
  return mapped
}
