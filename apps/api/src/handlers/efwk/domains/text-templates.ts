import type { EntityConfig } from '../../pegii/types'

export const textTemplatesEntities: EntityConfig[] = [
  {
    slug: 'master-text-template',
    tableName: 'MasterTextTemplates',
    idField: 'id',
    codeField: 'id',
    idType: 'integer',
    orderBy: 'ORDER BY id',
    searchKeywords: [],
  },
  {
    slug: 'master-text-template-placeholder',
    tableName: 'MasterTextTemplatePlaceholder',
    idField: 'id',
    codeField: 'id',
    idType: 'integer',
    orderBy: 'ORDER BY id',
    searchKeywords: [],
  },
]
