import type { EntityConfig } from '../../pegii/types'

export const emailEntities: EntityConfig[] = [
  {
    slug: 'email-source',
    tableName: 'emailsource',
    idField: 'id',
    codeField: 'order_number',
    idType: 'integer',
    orderBy: 'ORDER BY id DESC',
    searchKeywords: [],
  },
  {
    slug: 'email-template',
    tableName: 'email_templates',
    idField: 'id',
    codeField: 'id',
    idType: 'integer',
    orderBy: 'ORDER BY id DESC',
    searchKeywords: [],
  },
  {
    slug: 'sales-contact',
    tableName: 'SalesContacts',
    idField: 'Id',
    codeField: 'OrderNumber',
    idType: 'integer',
    orderBy: 'ORDER BY Id DESC',
    searchKeywords: [],
  },
]
