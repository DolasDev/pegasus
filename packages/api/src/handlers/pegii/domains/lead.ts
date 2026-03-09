import { empty, eqNum, eq, static_, dateLte, dateGte } from '../keyword-helpers'
import type { EntityConfig } from '../types'

const leadKeywords = [
  empty(),
  eqNum('ID', 'lead_number'),
  eqNum('CODE', 'lead_number'),
  eqNum('LEAD', 'lead_number'),
  eqNum('ORDER', 'order_num'),
  eqNum('SALE', 'order_num'),
  eqNum('SALESMAN', 'sm'),
  eq('BRANCH', 'branch'),
  eq('SOURCE', 'source_code'),
  dateLte('BEFORE', 'lead_date'),
  dateGte('AFTER', 'lead_date'),
  static_('ACTIVE', "active='Y'"),
  static_('NOTACTIVE', "active='N'"),
  static_('WEBPORTAL', "source_code='WEB'"),
  static_('SIRVA', "source_code='SIRVA'"),
  static_('UNASSIGNED', '(sm IS NULL OR sm=0)'),
  eq('STATUS', 'status'),
]

export const leadEntities: EntityConfig[] = [
  {
    slug: 'leads',
    tableName: 'leads',
    idField: 'lead_number',
    codeField: 'lead_number',
    idType: 'integer',
    orderBy: 'ORDER BY dist_desc',
    searchKeywords: leadKeywords,
  },
  {
    slug: 'lead-sources',
    tableName: 'lead_source',
    idField: 'id',
    codeField: 'source_code',
    idType: 'integer',
    orderBy: 'ORDER BY source_desc',
    searchKeywords: [empty(), eqNum('ID', 'id'), eq('CODE', 'source_code')],
  },
  {
    slug: 'leads-demo',
    tableName: 'leadsdemo',
    idField: 'lead_number',
    codeField: 'lead_number',
    idType: 'integer',
    orderBy: 'ORDER BY lead_number',
    searchKeywords: leadKeywords,
  },
]
