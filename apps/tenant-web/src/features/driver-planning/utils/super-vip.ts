// ---------------------------------------------------------------------------
// Super-VIP predicate.
//
// `supervip` is a legacy TypeORM *entity property*, not a column: the NestJS
// entity aliased it onto `idc_break` (shipment.abstract.ts:133), which is what
// v_longhaul_shipments_v2 actually projects. TypeORM hydrated the alias; our
// rows come straight off the view (`SELECT s.*`, no projection layer), so every
// `shipment.supervip === 'Y'` test read undefined and the Super-VIP indicator
// could never fire. Same class as the destination-street (#569) and Operations
// (#570) accessors.
//
// Reads `idc_break` and still honors a literal `supervip` when a payload
// carries one, so any caller handing us an already-aliased row keeps working.
// ---------------------------------------------------------------------------

export function isSuperVip(shipment: any): boolean {
  if (!shipment) return false
  return shipment.idc_break === 'Y' || shipment.supervip === 'Y'
}
