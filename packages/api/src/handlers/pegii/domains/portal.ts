import { empty, eqNum, eq } from '../keyword-helpers'
import type { EntityConfig } from '../types'

export const portalEntities: EntityConfig[] = [
  {
    slug: 'portal-documents',
    tableName: 'PortalDocuments',
    idField: 'Id',
    codeField: 'Title',
    idType: 'integer',
    orderBy: 'ORDER BY Id',
    searchKeywords: [empty(), eqNum('ID', 'Id'), eq('CODE', 'Title')],
  },
  {
    slug: 'moving-documents',
    tableName: 'MovingDocuments',
    idField: 'Id',
    codeField: 'Title',
    idType: 'integer',
    orderBy: 'ORDER BY Id',
    searchKeywords: [empty(), eqNum('ID', 'Id'), eq('CODE', 'Title')],
  },
  {
    slug: 'portal-users',
    tableName: 'PortalUsers',
    idField: 'Id',
    codeField: 'AgentId',
    idType: 'integer',
    orderBy: 'ORDER BY AgentName',
    searchKeywords: [empty(), eqNum('ID', 'Id'), eq('CODE', 'AgentId')],
  },
]
