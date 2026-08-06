// ---------------------------------------------------------------------------
// Super-VIP predicate.
//
// `supervip` is a legacy TypeORM *entity property*, not a column: the NestJS
// entity aliased it onto `idc_break` (shipment.abstract.ts:133), which is what
// v_longhaul_shipments_v2 actually projects. TypeORM hydrated the alias; our
// rows come straight off the view (`SELECT s.*`, no projection layer), so every
// `shipment.supervip === 'Y'` test read undefined and the Super-VIP indicator
// could never fire (#571). Same class as the destination-street (#569) and
// Operations (#570) accessors.
//
// #571 also honored a literal `supervip` "in case a caller hands us an
// already-aliased row". Nothing does — the manifest confirms the view has no
// such column, and every fixture and route mock now carries `idc_break`. Keeping
// it would force this parameter to stay `any`, which is exactly the hole this
// phase closes, so the fallback is gone.
// ---------------------------------------------------------------------------

import type { LonghaulShipmentRow } from '@pegasus/longhaul-contracts'

export function isSuperVip(shipment: LonghaulShipmentRow | null | undefined): boolean {
  return shipment?.idc_break === 'Y'
}
