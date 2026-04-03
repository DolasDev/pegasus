import { empty, eqNum } from '../keyword-helpers'
import type { EntityConfig } from '../types'

export const storedProceduresEntities: EntityConfig[] = [
  {
    slug: 'master-stored-procedures',
    tableName: 'MasterStoredProcedures',
    idField: 'Id',
    codeField: 'Id',
    idType: 'integer',
    orderBy: 'ORDER BY Id',
    searchKeywords: [empty(), eqNum('ID', 'Id')],
  },
  {
    slug: 'master-stored-procedure-parameters',
    tableName: 'MasterStoredProcedureParameters',
    idField: 'Id',
    codeField: 'Id',
    idType: 'integer',
    orderBy: 'ORDER BY Id',
    searchKeywords: [empty(), eqNum('ID', 'Id')],
  },
]
