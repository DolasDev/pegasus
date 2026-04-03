import { empty, eqNum, eq, static_ } from '../keyword-helpers'
import type { EntityConfig } from '../types'

export const personEntities: EntityConfig[] = [
  {
    slug: 'people',
    tableName: 'People',
    idField: 'id',
    codeField: 'id',
    idType: 'integer',
    orderBy: 'ORDER BY name_full_sort, id',
    searchKeywords: [
      empty(),
      eqNum('ID', 'id'),
      eqNum('CODE', 'id'),
      eqNum('PERSON', 'id'),
      eq('ORG', 'organization_id'),
      eq('ORGANIZATION', 'organization_id'),
      eq('ACCOUNT', 'organization_id'),
      static_('ACTIVE', "active='Y'"),
      static_('NOTACTIVE', "active='N'"),
      {
        keyword: 'WITH',
        toSql: (p) => {
          switch (p.toUpperCase()) {
            case 'WEBPORTALACCESS':
              return "web_portal_access='Y'"
            default:
              return ''
          }
        },
      },
    ],
  },
  {
    slug: 'user-logins',
    tableName: 'UserLogins',
    idField: 'id',
    codeField: 'id',
    idType: 'integer',
    orderBy: 'ORDER BY OrganizationId, FullName',
    searchKeywords: [
      empty(),
      eqNum('ID', 'id'),
      eqNum('CODE', 'id'),
      eqNum('PERSON', 'PersonId'),
      eqNum('PERSONID', 'PersonId'),
      eq('ACCOUNT', 'OrganizationId'),
      eq('ORGANIZATION', 'OrganizationId'),
      static_('ACTIVE', "active='Y'"),
      static_('NOTACTIVE', "active='N'"),
    ],
  },
]
