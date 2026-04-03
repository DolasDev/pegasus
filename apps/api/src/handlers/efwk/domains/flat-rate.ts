import type { EntityConfig } from '../../pegii/types'

export const flatRateEntities: EntityConfig[] = [
  {
    slug: 'flat-rate-auto-master',
    tableName: 'FlatRateAutoMasters',
    idField: 'Id',
    codeField: 'Id',
    idType: 'integer',
    orderBy: 'ORDER BY Id DESC',
    searchKeywords: [],
  },
  {
    slug: 'flat-rate-auto-detail',
    tableName: 'FlatRateAutoDetails',
    idField: 'Id',
    codeField: 'MasterId',
    idType: 'integer',
    orderBy: 'ORDER BY Id ASC',
    searchKeywords: [],
  },
  {
    slug: 'auto-flat-rate',
    tableName: 'AutoFlatRates',
    idField: 'Id',
    codeField: 'Id',
    idType: 'integer',
    orderBy: 'ORDER BY Id',
    searchKeywords: [],
  },
]
