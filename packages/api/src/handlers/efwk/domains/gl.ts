import type { EntityConfig } from '../../pegii/types'

export const glEntities: EntityConfig[] = [
  {
    slug: 'gl-transaction-master',
    tableName: 'GLTransactionMaster',
    idField: 'id',
    codeField: 'settlement_num',
    idType: 'integer',
    orderBy: 'ORDER BY id DESC',
    searchKeywords: [],
  },
  {
    slug: 'gl-transaction-detail',
    tableName: 'GLTransactionDetail',
    idField: 'id',
    codeField: 'master_id',
    idType: 'integer',
    orderBy: 'ORDER BY id ASC',
    searchKeywords: [],
  },
]
