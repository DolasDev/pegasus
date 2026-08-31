import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'

import { makeTestStore, renderWithStore } from '../../../../__test-utils__/render-with-store'

// The thunk under this component posts through this module, so asserting on it
// is how we see the actual request body the API's shadow schema will validate.
vi.mock('../../../../utils/api', () => ({
  API: {
    patchShipmentShadow: vi.fn(() => Promise.resolve()),
  },
}))

import { fetchShipmentSuccess } from '../../../../redux/shipments'
import { ShipmentWeight, toWeight } from './index'
import { API } from '../../../../utils/api'

const shipment = (weight: unknown) =>
  ({
    order_num: 489316,
    pegasus_shadow: { weight },
  }) as any

const openEditor = (selectedShipment: any) => {
  const onUpdate = vi.fn()
  renderWithStore(<ShipmentWeight onUpdate={onUpdate} />, {
    shipments: { selectedShipment } as any,
    user: { user: { code: 'U1' } } as any,
  })
  // The scale icon toggles the popover open.
  fireEvent.click(screen.getAllByRole('button')[0])
  return { onUpdate, input: screen.getByLabelText('Enter New Weight:') as HTMLInputElement }
}

const save = () => fireEvent.click(screen.getByText('save'))

describe('toWeight', () => {
  it('coerces the input string to a number', () => {
    expect(toWeight('16200')).toBe(16200)
  })

  it('maps a cleared or unparsable field to null, never to 0', () => {
    expect(toWeight('')).toBeNull()
    expect(toWeight('   ')).toBeNull()
    expect(toWeight(null)).toBeNull()
    expect(toWeight(undefined)).toBeNull()
    expect(toWeight('abc')).toBeNull()
  })

  it('passes a number through unchanged', () => {
    expect(toWeight(16200)).toBe(16200)
  })
})

describe('ShipmentWeight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The reported bug: an *edited* weight was posted as the input's raw string
  // ("16200") and rejected by the shadow schema ("expected number, received
  // string"), while an unedited one passed because the initial state was
  // already a number.
  it('posts an edited weight as a number', () => {
    const { onUpdate, input } = openEditor(shipment(15000))
    fireEvent.change(input, { target: { value: '16200' } })
    save()

    expect(API.patchShipmentShadow).toHaveBeenCalledWith({
      order_num: 489316,
      weight: 16200,
    })
    expect(onUpdate).toHaveBeenCalledWith(16200)
  })

  it('posts an unedited weight as a number', () => {
    openEditor(shipment(15000))
    save()

    expect(API.patchShipmentShadow).toHaveBeenCalledWith({
      order_num: 489316,
      weight: 15000,
    })
  })

  // Number('') is 0 — posting that would overwrite a real weight with zero.
  it('posts null when the field is cleared', () => {
    const { input } = openEditor(shipment(15000))
    fireEvent.change(input, { target: { value: '' } })
    save()

    expect(API.patchShipmentShadow).toHaveBeenCalledWith({
      order_num: 489316,
      weight: null,
    })
  })

  // A shipment with no shadow row used to seed the input with Number(undefined)
  // === NaN — a controlled input whose value is not a real value.
  it('starts empty — not NaN — when the shipment has no shadow weight', () => {
    const { input } = openEditor(shipment(undefined))
    expect(input.value).toBe('')
  })

  // Switching shipments does not remount the popover, so its state has to
  // follow the selection — otherwise a save writes the previous order's weight
  // onto the new one.
  it('re-seeds from the newly selected shipment instead of carrying the old weight', () => {
    const store = makeTestStore({
      shipments: { selectedShipment: shipment(15000) } as any,
      user: { user: { code: 'U1' } } as any,
    })
    renderWithStore(<ShipmentWeight onUpdate={vi.fn()} />, { store })

    act(() => {
      store.dispatch(
        fetchShipmentSuccess({ order_num: 777777, pegasus_shadow: { weight: 9000 } } as any),
      )
    })

    fireEvent.click(screen.getAllByRole('button')[0])
    expect((screen.getByLabelText('Enter New Weight:') as HTMLInputElement).value).toBe('9000')
    save()

    expect(API.patchShipmentShadow).toHaveBeenCalledWith({
      order_num: 777777,
      weight: 9000,
    })
  })
})
