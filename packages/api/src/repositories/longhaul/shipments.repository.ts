// ---------------------------------------------------------------------------
// Longhaul shipments repository — Knex queries against v_dispatch_planning
// ---------------------------------------------------------------------------

import type { Knex } from 'knex'

const SHIPMENTS_TABLE = 'v_dispatch_planning'
const ACTIVITIES_TABLE = 'LongDistanceDispatchActivity'
const COVERAGE_TABLE = 'longhaul_shipmentcoverage'
const SALES_TABLE = 'sales'
const EXTRA_LOCATIONS_TABLE = 'pegasus_extra_location'

export interface ShipmentQuery {
  searchTerm?: string
  filters?: {
    order_num?: Array<{ value: unknown }>
    origin?: Array<{ value: string }>
    destination?: Array<{ value: string }>
    origin_zone?: Array<{ value: string }>
    destination_zone?: Array<{ value: string }>
    operations_id?: Array<{ value: string }>
    weight?: [number | null, number | null]
    mileage?: [number | null, number | null]
    pack_date?: [string | null, string | null]
    load_date?: [string | null, string | null]
    delivery_date?: [string | null, string | null]
    short_haul?: Array<{ value: string }>
    move_type?: Array<{ value: string }>
    assigned?: Array<{ value: string }>
    shaul?: Array<{ value: string }>
    TripStatus_id?: Array<{ value: string }>
    Is_Trip_Planning?: boolean
  }
  sortBy?: { value: string; order: string }
}

/** Fetch shipments matching optional search term and filter criteria. */
export async function findShipmentsWithQuery(db: Knex, query: ShipmentQuery) {
  let qb = db(SHIPMENTS_TABLE)
    .select(
      `${SHIPMENTS_TABLE}.*`,
      'ps.weight as shadow_weight',
      'ps.lng_dis_comments as shadow_comments',
      'ps.operations_id as operations_id',
      'ps.operations_name as operations_name',
    )
    .leftJoin(`${SALES_TABLE} as ps`, `${SHIPMENTS_TABLE}.order_num`, 'ps.order_num')
    .leftJoin('v_longhaul_states as os', `${SHIPMENTS_TABLE}.shipper_state`, 'os.geo_code')
    .leftJoin('v_longhaul_states as ds', `${SHIPMENTS_TABLE}.consignee_state`, 'ds.geo_code')

  if (query.searchTerm && query.searchTerm.length >= 3) {
    const term = query.searchTerm.toLowerCase()
    qb = qb.where((builder) => {
      builder
        .whereRaw(`CAST(${SHIPMENTS_TABLE}.order_num AS varchar) LIKE ?`, [`${term}%`])
        .orWhereRaw(`LOWER(${SHIPMENTS_TABLE}.shipper_name) LIKE ?`, [`%${term}%`])
        .orWhereRaw(`LOWER(${SHIPMENTS_TABLE}.avl_reg) LIKE ?`, [`${term}%`])
    })
  } else if (query.filters) {
    const f = query.filters

    if (f.order_num?.length) {
      const nums = f.order_num.map((o) => o.value).filter(Boolean) as string[]
      if (nums.length) qb = qb.whereIn(`${SHIPMENTS_TABLE}.order_num`, nums)
    }

    if (f.origin?.length) {
      const states = f.origin.map((o) => o.value).filter(Boolean)
      if (states.length) qb = qb.whereIn(`${SHIPMENTS_TABLE}.shipper_state`, states)
    }

    if (f.destination?.length) {
      const states = f.destination.map((d) => d.value).filter(Boolean)
      if (states.length) qb = qb.whereIn(`${SHIPMENTS_TABLE}.consignee_state`, states)
    }

    if (f.origin_zone?.length) {
      const zones = f.origin_zone.map((z) => z.value).filter(Boolean)
      if (zones.length) qb = qb.whereIn('os.zone', zones)
    }

    if (f.destination_zone?.length) {
      const zones = f.destination_zone.map((z) => z.value).filter(Boolean)
      if (zones.length) qb = qb.whereIn('ds.zone', zones)
    }

    if (f.operations_id?.length) {
      const ids = f.operations_id.map((o) => o.value).filter(Boolean)
      if (ids.length) qb = qb.whereIn('ps.operations_id', ids)
    }

    if (f.weight) {
      const [min, max] = f.weight.map((v) => (v ? Number(v) : null))
      if (min != null) qb = qb.where(`${SHIPMENTS_TABLE}.total_est_wt`, '>=', min)
      if (max != null) qb = qb.where(`${SHIPMENTS_TABLE}.total_est_wt`, '<=', max)
    }

    if (f.mileage) {
      const [min, max] = f.mileage.map((v) => (v ? Number(v) : null))
      if (min != null) qb = qb.where(`${SHIPMENTS_TABLE}.mileage`, '>=', min)
      if (max != null) qb = qb.where(`${SHIPMENTS_TABLE}.mileage`, '<=', max)
    }

    if (f.pack_date) {
      const [start, end] = f.pack_date
      if (start && end) {
        qb = qb.where((b) =>
          b
            .whereBetween(`${SHIPMENTS_TABLE}.plan_pack`, [start, end])
            .orWhereBetween(`${SHIPMENTS_TABLE}.pack_date2`, [start, end]),
        )
      } else if (end) {
        qb = qb.whereRaw(`NOT (${SHIPMENTS_TABLE}.plan_pack > ?)`, [end])
      } else if (start) {
        qb = qb.whereRaw(`NOT (${SHIPMENTS_TABLE}.pack_date2 < ?)`, [start])
      }
    }

    if (f.load_date) {
      const [start, end] = f.load_date
      if (start && end) {
        qb = qb.where((b) =>
          b
            .whereBetween(`${SHIPMENTS_TABLE}.plan_load`, [start, end])
            .orWhereBetween(`${SHIPMENTS_TABLE}.load_date2`, [start, end]),
        )
      } else if (end) {
        qb = qb.whereRaw(`NOT (${SHIPMENTS_TABLE}.plan_load > ?)`, [end])
      } else if (start) {
        qb = qb.whereRaw(`NOT (${SHIPMENTS_TABLE}.load_date2 < ?)`, [start])
      }
    }

    if (f.delivery_date) {
      const [start, end] = f.delivery_date
      if (start && end) {
        qb = qb.where((b) =>
          b
            .whereBetween(`${SHIPMENTS_TABLE}.plan_del`, [start, end])
            .orWhereBetween(`${SHIPMENTS_TABLE}.del_date2`, [start, end]),
        )
      } else if (end) {
        qb = qb.whereRaw(`NOT (${SHIPMENTS_TABLE}.plan_del > ?)`, [end])
      } else if (start) {
        qb = qb.whereRaw(`NOT (${SHIPMENTS_TABLE}.del_date2 < ?)`, [start])
      }
    }

    if (f.short_haul?.length) {
      const modes = f.short_haul.map((s) => s.value).filter(Boolean)
      if (modes.length) qb = qb.whereIn(`${SHIPMENTS_TABLE}.haul_mode`, modes)
    }

    if (f.move_type?.length) {
      const types = f.move_type.map((m) => m.value).filter(Boolean)
      if (types.length) qb = qb.whereIn(`${SHIPMENTS_TABLE}.import_export`, types)
    }

    if (f.assigned?.length === 1) {
      const val = f.assigned[0]?.value ?? ''
      if (val.includes('No')) {
        qb = qb.where((b) =>
          b.where(`${SHIPMENTS_TABLE}.driver_id`, '0').orWhereNull(`${SHIPMENTS_TABLE}.driver_id`),
        )
      } else if (val.includes('Yes')) {
        qb = qb.whereRaw(
          `${SHIPMENTS_TABLE}.driver_id IN (SELECT driver_id FROM v_longhaul_drivers WHERE driver_id <> 0)`,
        )
      }
    }

    if (f.shaul?.length) {
      const vals = f.shaul.map((s) => s.value).filter(Boolean)
      if (vals.length) qb = qb.whereIn(`${SHIPMENTS_TABLE}.shaul`, vals)
    }

    if (f.Is_Trip_Planning) {
      const importExportTypes = process.env['IMPORT_EXPORT_TYPES']?.split(',') ?? ['H']
      qb = qb
        .where(`${SHIPMENTS_TABLE}.shipment_status`, 'A')
        .whereIn(`${SHIPMENTS_TABLE}.import_export`, importExportTypes)
        .whereNull(`${SHIPMENTS_TABLE}.del_actual`)
    }
  }

  if (query.sortBy?.order) {
    qb = qb
      .orderBy(
        `${SHIPMENTS_TABLE}.${query.sortBy.value}`,
        query.sortBy.order.toUpperCase() as 'ASC' | 'DESC',
      )
      .orderBy(`${SHIPMENTS_TABLE}.shipper_name`, 'asc')
  } else {
    qb = qb
      .orderBy(`${SHIPMENTS_TABLE}.plan_load`, 'asc')
      .orderBy(`${SHIPMENTS_TABLE}.shipper_name`, 'asc')
  }

  const shipments = await qb

  // Attach activities and coverage
  const orderNums = shipments.map((s) => s.order_num as number)
  if (orderNums.length === 0) return shipments

  const [activities, coverages, extraLocations] = await Promise.all([
    db(ACTIVITIES_TABLE)
      .select(
        `${ACTIVITIES_TABLE}.*`,
        'at.code as activityType_code',
        'at.name as activityType_name',
        'at.abbreviation as activityType_abbreviation',
      )
      .leftJoin('Longhaul_ActivityType as at', `${ACTIVITIES_TABLE}.ActivityType_code`, 'at.code')
      .whereIn(`${ACTIVITIES_TABLE}.order_num`, orderNums),
    db(COVERAGE_TABLE).whereIn('order_num', orderNums),
    db(EXTRA_LOCATIONS_TABLE)
      .whereIn('order_num', orderNums)
      .catch(() => [] as unknown[]),
  ])

  const activitiesByOrder: Record<number, unknown[]> = {}
  for (const a of activities) {
    const on = a.order_num as number
    if (!activitiesByOrder[on]) activitiesByOrder[on] = []
    activitiesByOrder[on].push(a)
  }

  const coverageByOrder: Record<number, unknown> = {}
  for (const c of coverages) {
    coverageByOrder[c.order_num as number] = c
  }

  const extraByOrder: Record<number, unknown[]> = {}
  for (const e of extraLocations as Array<Record<string, unknown>>) {
    const on = e['order_num'] as number
    if (!extraByOrder[on]) extraByOrder[on] = []
    extraByOrder[on].push(e)
  }

  return shipments.map((s) => ({
    ...s,
    activities: activitiesByOrder[s.order_num as number] ?? [],
    packing_coverage: coverageByOrder[s.order_num as number] ?? null,
    extra_locations: extraByOrder[s.order_num as number] ?? [],
  }))
}

/** Fetch shipments by order_num IN list. */
export async function findShipmentsByIds(db: Knex, orderNums: number[]) {
  if (orderNums.length === 0) return []

  const shipments = await db(SHIPMENTS_TABLE)
    .select(`${SHIPMENTS_TABLE}.*`)
    .leftJoin(`${SALES_TABLE} as ps`, `${SHIPMENTS_TABLE}.order_num`, 'ps.order_num')
    .whereIn(`${SHIPMENTS_TABLE}.order_num`, orderNums)

  const [activities, coverages, extraLocations] = await Promise.all([
    db(ACTIVITIES_TABLE)
      .select(
        `${ACTIVITIES_TABLE}.*`,
        'at.code as activityType_code',
        'at.name as activityType_name',
        'at.abbreviation as activityType_abbreviation',
      )
      .leftJoin('Longhaul_ActivityType as at', `${ACTIVITIES_TABLE}.ActivityType_code`, 'at.code')
      .whereIn(`${ACTIVITIES_TABLE}.order_num`, orderNums),
    db(COVERAGE_TABLE).whereIn('order_num', orderNums),
    db(EXTRA_LOCATIONS_TABLE)
      .whereIn('order_num', orderNums)
      .catch(() => [] as unknown[]),
  ])

  const activitiesByOrder: Record<number, unknown[]> = {}
  for (const a of activities) {
    const on = a.order_num as number
    if (!activitiesByOrder[on]) activitiesByOrder[on] = []
    activitiesByOrder[on].push(a)
  }

  const coverageByOrder: Record<number, unknown> = {}
  for (const c of coverages) {
    coverageByOrder[c.order_num as number] = c
  }

  const extraByOrder: Record<number, unknown[]> = {}
  for (const e of extraLocations as Array<Record<string, unknown>>) {
    const on = e['order_num'] as number
    if (!extraByOrder[on]) extraByOrder[on] = []
    extraByOrder[on].push(e)
  }

  return shipments.map((s) => ({
    ...s,
    activities: activitiesByOrder[s.order_num as number] ?? [],
    packing_coverage: coverageByOrder[s.order_num as number] ?? null,
    extra_locations: extraByOrder[s.order_num as number] ?? [],
  }))
}

/** Upsert shipment coverage record. */
export async function saveCoverage(
  db: Knex,
  coverageData: {
    order_num: number
    activity_code: string
    coverage_agent_id: string
    [key: string]: unknown
  },
) {
  const existing = await db(COVERAGE_TABLE)
    .where({
      order_num: coverageData.order_num,
      activity_code: coverageData.activity_code,
      coverage_agent_id: coverageData.coverage_agent_id,
    })
    .first()

  if (existing) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, ...rest } = coverageData as { id?: unknown } & typeof coverageData
    await db(COVERAGE_TABLE)
      .where('id', existing.id as number)
      .update({ ...rest, updated_date: new Date() })
    return db(COVERAGE_TABLE)
      .where('id', existing.id as number)
      .first()
  } else {
    const result = await db(COVERAGE_TABLE).insert({ ...coverageData, created_date: new Date() })
    const newId = Array.isArray(result) ? result[0] : result
    return db(COVERAGE_TABLE).where('id', newId).first()
  }
}

/** Update weight-related fields on a shipment shadow/weight record. */
export async function patchWeight(
  db: Knex,
  shipmentId: number,
  weightData: Record<string, unknown>,
) {
  return db('longhaul_shipment_weight_link')
    .where('order_num', shipmentId)
    .update({ ...weightData, updated_at: new Date() })
}

/** Update dispatcher/operations fields in the sales (pegasus shadow) table. */
export async function patchShipmentShadow(
  db: Knex,
  data: { order_num: number } & Record<string, unknown>,
) {
  if (!data.order_num) return false

  const { order_num, ...rest } = data
  const existing = await db(SALES_TABLE).where('order_num', order_num).first()

  if (existing) {
    await db(SALES_TABLE).where('order_num', order_num).update(rest)
  } else {
    await db(SALES_TABLE).insert({ order_num, ...rest })
  }

  return true
}
