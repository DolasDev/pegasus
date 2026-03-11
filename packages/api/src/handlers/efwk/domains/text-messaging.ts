import type { EntityConfig } from '../../pegii/types'

export const textMessagingEntities: EntityConfig[] = [
  {
    slug: 'text-address',
    tableName: 'TextMessageAddresses',
    idField: 'Id',
    codeField: 'CellPhoneNumber',
    idType: 'integer',
    orderBy: 'ORDER BY Id DESC',
    searchKeywords: [],
  },
  {
    slug: 'cellular-service-provider',
    tableName: 'CellularServiceProviders',
    idField: 'Id',
    codeField: 'Name',
    idType: 'integer',
    orderBy: 'ORDER BY Id ASC',
    searchKeywords: [],
  },
  {
    slug: 'conversation-source-record',
    tableName: 'sales', // From Ctx.vb mapping
    idField: 'order_num', // From HasKey in Ctx.vb
    codeField: 'order_num',
    idType: 'string',
    orderBy: 'ORDER BY order_num DESC',
    searchKeywords: [],
  },
  {
    slug: 'ring-central-token',
    tableName: 'ringcentral_tokens',
    idField: 'id',
    codeField: 'id',
    idType: 'integer',
    orderBy: 'ORDER BY id DESC',
    searchKeywords: [],
  },
]
