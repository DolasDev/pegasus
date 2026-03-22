import type { EntityConfig } from '../../pegii/types'

export const mastersEntities: EntityConfig[] = [
  {
    slug: 'master-insurance-type',
    tableName: 'masterinsurancetypes',
    idField: 'id',
    codeField: 'code',
    idType: 'integer',
    orderBy: 'ORDER BY id',
    searchKeywords: [],
  },
]
