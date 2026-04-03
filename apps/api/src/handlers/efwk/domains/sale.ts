import type { EntityConfig } from '../../pegii/types'

export const saleEntities: EntityConfig[] = [
  {
    slug: 'crew-service',
    tableName: 'CrewServices',
    idField: 'Id',
    codeField: 'Id',
    idType: 'integer',
    orderBy: 'ORDER BY Id DESC',
    searchKeywords: [],
  },
]
