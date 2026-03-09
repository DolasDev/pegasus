import { empty, eqNum, eq, static_ } from '../keyword-helpers'
import type { EntityConfig, SqlFragment } from '../types'

export const vehicleEntities: EntityConfig[] = [
  {
    slug: 'vehicles',
    tableName: 'vehicles',
    idField: 'id',
    codeField: 'rvs_num',
    idType: 'integer',
    orderBy: 'ORDER BY rvs_num',
    searchKeywords: [
      empty(),
      eqNum('ID', 'id'),
      eq('CODE', 'rvs_num'),
      {
        keyword: 'TRUCK',
        toSql: (p, paramId): SqlFragment => {
          const id = paramId()
          return { sql: `vehicle_type='T' AND rvs_num=@${id}`, params: { [id]: p } }
        },
      },
      {
        keyword: 'TRAILER',
        toSql: (p, paramId): SqlFragment => {
          const id = paramId()
          return { sql: `vehicle_type='R' AND rvs_num=@${id}`, params: { [id]: p } }
        },
      },
      {
        keyword: 'AUTO',
        toSql: (p, paramId): SqlFragment => {
          const id = paramId()
          return { sql: `vehicle_type='A' AND rvs_num=@${id}`, params: { [id]: p } }
        },
      },
      eq('PLATE', 'plate'),
      eq('AVL', 'avl_reg'),
      eq('DRIVER', 'driver_id'),
      static_('ACTIVE', "active='Y'"),
      static_('NOTACTIVE', "active='N'"),
    ],
  },
  {
    slug: 'vehicle-mileage',
    tableName: 'mileage',
    idField: 'id',
    codeField: 'plate',
    idType: 'integer',
    orderBy: 'ORDER BY id',
    searchKeywords: [empty(), eqNum('ID', 'id'), eq('CODE', 'plate'), eq('PLATE', 'plate')],
  },
  {
    slug: 'vehicle-repairs',
    tableName: 'repairs',
    idField: 'repair_id',
    codeField: 'plates',
    idType: 'integer',
    orderBy: 'ORDER BY repair_id',
    searchKeywords: [
      empty(),
      eqNum('ID', 'repair_id'),
      eq('CODE', 'plates'),
      eq('PLATE', 'plates'),
    ],
  },
  {
    slug: 'vehicle-violations',
    tableName: 'violations',
    idField: 'id',
    codeField: 'truck_num',
    idType: 'integer',
    orderBy: 'ORDER BY id',
    searchKeywords: [empty(), eqNum('ID', 'id'), eq('CODE', 'truck_num')],
  },
]
