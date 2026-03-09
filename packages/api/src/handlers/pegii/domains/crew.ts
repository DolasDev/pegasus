import { empty, eqNum, eq, static_ } from '../keyword-helpers'
import type { EntityConfig } from '../types'

export const crewEntities: EntityConfig[] = [
  {
    slug: 'crews',
    tableName: 'crews',
    idField: 'id',
    codeField: 'employee_id',
    idType: 'integer',
    orderBy: 'ORDER BY crew_class, is_long_dist_drv, employee_first, employee_last',
    searchKeywords: [
      empty(),
      eqNum('ID', 'id'),
      eq('CODE', 'employee_id'),
      static_('DRIVERS', "crew_class='D'"),
      static_('LDDRV', "is_long_dist_drv='Y'"),
      static_('LOCALDRIVER', "crew_class='D' AND is_long_dist_drv='N'"),
      static_('LOCALHELPERS', "crew_class IN ('D','H')"),
      static_('LOCALHELPERSONLY', "crew_class='H'"),
      eq('AGENCY', 'agency_code'),
      static_('ACTIVE', 'term_date IS NULL'),
      static_('NOTACTIVE', 'term_date IS NOT NULL'),
    ],
  },
]
