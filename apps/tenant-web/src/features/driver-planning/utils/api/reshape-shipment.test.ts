import { describe, it, expect } from 'vitest'
import { reshapeShipment, reshapeShipmentList } from './reshape-shipment'

describe('reshapeShipment', () => {
  it('builds pegasus_shadow from the flat bridge columns', () => {
    const flat = {
      order_num: 12345,
      shipper_name: 'DOE, JANE',
      shadow_weight: 8200,
      shadow_comments: '@all please confirm',
      operations_id: 'OP1',
      operations_name: 'Pat Ops',
    }
    const s = reshapeShipment(flat)
    expect(s.pegasus_shadow).toEqual({
      order_num: 12345,
      weight: 8200,
      lng_dis_comments: '@all please confirm',
      operations_id: 'OP1',
      operations_name: 'Pat Ops',
    })
    // Flat columns are preserved.
    expect(s.order_num).toBe(12345)
    expect(s.shipper_name).toBe('DOE, JANE')
  })

  it('uses nulls for absent shadow columns', () => {
    const s = reshapeShipment({ order_num: 1 })
    expect(s.pegasus_shadow).toEqual({
      order_num: 1,
      weight: null,
      lng_dis_comments: null,
      operations_id: null,
      operations_name: null,
    })
  })

  it('does not clobber an already-nested shipment', () => {
    const nested = { order_num: 1, pegasus_shadow: { weight: 100, lng_dis_comments: 'hi' } }
    expect(reshapeShipment(nested)).toBe(nested)
  })

  it('reshapeShipmentList maps an array and passes non-arrays through', () => {
    expect(reshapeShipmentList([{ order_num: 1, shadow_weight: 5 }])[0].pegasus_shadow.weight).toBe(
      5,
    )
    expect(reshapeShipmentList(null)).toBeNull()
    expect(reshapeShipmentList(undefined)).toBeUndefined()
  })
})
