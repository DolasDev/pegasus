import type { EntityConfig } from '../../pegii/types'

export const atlasEntities: EntityConfig[] = [
  {
    slug: 'atlas-invoice-master',
    tableName: 'AtlasInvoiceMasters',
    idField: 'Id',
    codeField: 'InvoiceNumber', // Guessing natural key
    idType: 'integer',
    orderBy: 'ORDER BY Id DESC',
    searchKeywords: [],
  },
  {
    slug: 'atlas-invoice-distribution',
    tableName: 'AtlasInvoiceDistributions',
    idField: 'Id',
    codeField: 'MasterId',
    idType: 'integer',
    orderBy: 'ORDER BY Id ASC',
    searchKeywords: [],
  },
  {
    slug: 'atlas-payable-distribution-total',
    tableName: 'AtlasPayableDistributionTotals',
    idField: 'Id',
    codeField: 'Id',
    idType: 'integer',
    orderBy: 'ORDER BY Id ASC',
    searchKeywords: [],
  },
  {
    slug: 'atlas-driver-settlement-header',
    tableName: 'AtlasDriverSettlementHeaders',
    idField: 'Id',
    codeField: 'SettlementNumber',
    idType: 'integer',
    orderBy: 'ORDER BY Id DESC',
    searchKeywords: [],
  },
  {
    slug: 'atlas-driver-settlement-distribution',
    tableName: 'AtlasDriverSettlementDistributions',
    idField: 'Id',
    codeField: 'HeaderId',
    idType: 'integer',
    orderBy: 'ORDER BY Id ASC',
    searchKeywords: [],
  },
  {
    slug: 'atlas-settlement-code',
    tableName: 'AtlasSettlementCodes',
    idField: 'Id',
    codeField: 'Code',
    idType: 'integer',
    orderBy: 'ORDER BY Id',
    searchKeywords: [],
  },
]
