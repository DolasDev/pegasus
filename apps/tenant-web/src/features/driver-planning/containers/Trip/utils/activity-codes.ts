// Activity-type key → short code used by the on-prem MSSQL.
// Mirrors the mapping the legacy NestJS+Electron app used; the generated
// PACK/LOAD/RDEL activity rows carry these codes directly, while higher-level
// "intent" names (PACKING/PICKUP/DELIVERY/…) come from the application layer.

export const ACTIVITY_TYPE_CODE: Record<string, string> = {
  PACKING: 'PACK',
  PICKUP: 'LOAD',
  DELIVERY: 'RDEL',
  AGENTPICKUP: 'R19I',
  DOCKPICKUP: 'R19O',
  WAREHOUSE: 'WHSE',
  EXTRAPICKUP: 'XPU',
  EXTRADELIVERY: 'XDEL',
  UNPACK: 'UNPK',
  SITIN: 'SITIN',
  SITOUT: 'SITOUT',
}
