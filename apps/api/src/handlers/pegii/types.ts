import type { Hono } from 'hono'
import type { OnPremEnv } from '../../types.onprem'

export interface SqlFragment {
  sql: string
  params: Record<string, unknown>
}

export interface SearchKeyword {
  keyword: string
  toSql: (param: string, paramId: () => string) => string | SqlFragment
}

export interface EntityConfig {
  slug: string
  tableName: string
  idField: string
  codeField: string
  idType: 'integer' | 'string'
  orderBy: string
  listFields?: string
  searchKeywords: SearchKeyword[]
  freeTextColumns?: string[]
  customRoutes?: (router: Hono<OnPremEnv>) => void
}

export interface ColumnDef {
  name: string
  dataType: string
  isNullable: boolean
  maxLength: number | null
}
