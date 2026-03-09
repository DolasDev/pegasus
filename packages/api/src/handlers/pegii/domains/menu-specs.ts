import { empty, eqNum, eq, static_ } from '../keyword-helpers'
import type { EntityConfig } from '../types'

export const menuSpecsEntities: EntityConfig[] = [
  {
    slug: 'report-menu-specs',
    tableName: 'ReportMenuSpecifications',
    idField: 'Id',
    codeField: 'Id',
    idType: 'integer',
    orderBy: 'ORDER BY Id',
    searchKeywords: [
      empty(),
      eqNum('ID', 'Id'),
      static_('ACTIVE', "active='Y'"),
      static_('NOTACTIVE', "active='N'"),
      eq('FORM', 'form_name'),
      eq('ACTION', 'action'),
      eqNum('PARENT', 'parent_id'),
    ],
  },
]
