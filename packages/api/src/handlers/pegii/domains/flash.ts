import { empty, eqNum, eq, dateLte, dateGte } from '../keyword-helpers'
import type { EntityConfig } from '../types'

const flashKeywords = [
  empty(),
  eqNum('YEAR', 'year'),
  eqNum('WEEK', 'week'),
  dateLte('BEFORE', 'week'),
  dateGte('AFTER', 'week'),
  eq('BRANCH', 'branch'),
]

export const flashEntities: EntityConfig[] = [
  {
    slug: 'flash-claims',
    tableName: 'flash_claims',
    idField: 'ID',
    codeField: 'ID',
    idType: 'integer',
    orderBy: 'ORDER BY year, week',
    searchKeywords: [...flashKeywords, eqNum('ID', 'ID')],
  },
  {
    slug: 'flash-international',
    tableName: 'flash_q',
    idField: 'ID',
    codeField: 'ID',
    idType: 'integer',
    orderBy: 'ORDER BY ID',
    searchKeywords: [...flashKeywords, eqNum('ID', 'ID')],
  },
  {
    slug: 'flash-recap',
    tableName: 'flashtemp',
    idField: 'ID',
    codeField: 'ID',
    idType: 'integer',
    orderBy: 'ORDER BY ID',
    searchKeywords: [...flashKeywords, eqNum('ID', 'ID')],
  },
  {
    slug: 'flash-customer-service',
    tableName: 'flash_cs',
    idField: 'ID',
    codeField: 'ID',
    idType: 'integer',
    orderBy: 'ORDER BY ID',
    searchKeywords: [...flashKeywords, eqNum('ID', 'ID')],
  },
  {
    slug: 'flash-billing',
    tableName: 'flash_b',
    idField: 'id',
    codeField: 'id',
    idType: 'integer',
    orderBy: 'ORDER BY id',
    searchKeywords: [...flashKeywords, eqNum('ID', 'id')],
  },
  {
    slug: 'flash-accounting',
    tableName: 'flashap',
    idField: 'ID',
    codeField: 'ID',
    idType: 'integer',
    orderBy: 'ORDER BY ID',
    searchKeywords: [...flashKeywords, eqNum('ID', 'ID')],
  },
]
