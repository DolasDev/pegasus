import type { EntityConfig } from '../../pegii/types'

export const loansEntities: EntityConfig[] = [
  {
    slug: 'loan-master',
    tableName: 'LoanMasters',
    idField: 'Id',
    codeField: 'Id',
    idType: 'integer',
    orderBy: 'ORDER BY Id DESC',
    searchKeywords: [],
  },
  {
    slug: 'loan-detail',
    tableName: 'LoanDetails',
    idField: 'Id',
    codeField: 'MasterId',
    idType: 'integer',
    orderBy: 'ORDER BY Id ASC',
    searchKeywords: [],
  },
]
