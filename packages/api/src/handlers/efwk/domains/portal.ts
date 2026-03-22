import type { EntityConfig } from '../../pegii/types'

export const portalEntities: EntityConfig[] = [
  {
    slug: 'portal-user',
    tableName: 'PortalUsers', // EF pluralized default
    idField: 'Id',
    codeField: 'AgentId',
    idType: 'integer',
    orderBy: 'ORDER BY Id',
    searchKeywords: [],
  },
  {
    slug: 'portal-document',
    tableName: 'PortalDocuments', // EF pluralized default
    idField: 'Id',
    codeField: 'Id',
    idType: 'integer',
    orderBy: 'ORDER BY Id DESC',
    searchKeywords: [],
  },
  {
    slug: 'moving-document',
    tableName: 'MovingDocuments', // EF pluralized default
    idField: 'Id',
    codeField: 'Id',
    idType: 'integer',
    orderBy: 'ORDER BY Id DESC',
    searchKeywords: [],
  },
]
