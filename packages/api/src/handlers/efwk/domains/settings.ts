import type { EntityConfig } from '../../pegii/types'

export const settingsEntities: EntityConfig[] = [
  {
    slug: 'account-preference',
    tableName: 'account',
    idField: 'id',
    codeField: 'agent_id',
    idType: 'integer',
    orderBy: 'ORDER BY id',
    searchKeywords: [],
  },
  {
    slug: 'setting',
    tableName: 'settings',
    idField: 'Id',
    codeField: 'name',
    idType: 'integer',
    orderBy: 'ORDER BY Id',
    searchKeywords: [],
  },
  {
    slug: 'base-date-field-map',
    tableName: 'BaseDateFieldMaps',
    idField: 'Id',
    codeField: 'Id',
    idType: 'integer',
    orderBy: 'ORDER BY Id',
    searchKeywords: [],
  },
  {
    slug: 'hauler-percentage',
    tableName: 'HaulerPercentages',
    idField: 'Id',
    codeField: 'Id',
    idType: 'integer',
    orderBy: 'ORDER BY Id',
    searchKeywords: [],
  },
]
