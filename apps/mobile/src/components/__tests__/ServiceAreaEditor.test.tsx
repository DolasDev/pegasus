import React from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { ServiceAreaEditor, parseTypedArea } from '../ServiceAreaEditor'
import { LaborService } from '../../services/laborService'

jest.mock('../../services/laborService', () => ({
  LaborService: { searchPlaces: jest.fn() },
}))

const searchPlaces = LaborService.searchPlaces as jest.Mock

describe('parseTypedArea', () => {
  it('accepts "City, ST" only for a US state or Canadian province', () => {
    expect(parseTypedArea(' Spring Hill , tn ')).toEqual({ city: 'Spring Hill', region: 'TN' })
    expect(parseTypedArea('Guelph, ON')).toEqual({ city: 'Guelph', region: 'ON' })
    expect(parseTypedArea('Springfield, ZZ')).toBeNull()
    expect(parseTypedArea('Springfield')).toBeNull()
  })
})

describe('ServiceAreaEditor', () => {
  it('suggests places, hides ones already listed, and adds the picked one', async () => {
    searchPlaces.mockResolvedValue([
      { city: 'Macon', region: 'GA', country: 'US' },
      { city: 'Macon', region: 'MO', country: 'US' },
    ])
    const onChange = jest.fn()
    const { getByLabelText, findByText, queryByText } = render(
      <ServiceAreaEditor areas={[{ city: 'Macon', region: 'GA' }]} onChange={onChange} />,
    )
    fireEvent.changeText(getByLabelText('Add a service area'), 'mac')
    fireEvent.press(await findByText(/^Macon, MO/))
    expect(searchPlaces).toHaveBeenCalledWith('mac')
    expect(onChange).toHaveBeenCalledWith([
      { city: 'Macon', region: 'GA' },
      { city: 'Macon', region: 'MO' },
    ])
    // The listed chip is "Macon, GA"; the suggestion of it is filtered out.
    expect(queryByText('Add “Macon, MO”')).toBeNull()
  })

  it('adds a typed "City, ST" the place list does not know', async () => {
    searchPlaces.mockResolvedValue([])
    const onChange = jest.fn()
    const { getByLabelText, findByText } = render(
      <ServiceAreaEditor areas={[]} onChange={onChange} />,
    )
    fireEvent.changeText(getByLabelText('Add a service area'), 'Tiny Town, GA')
    fireEvent.press(await findByText('Add “Tiny Town, GA”'))
    expect(onChange).toHaveBeenCalledWith([{ city: 'Tiny Town', region: 'GA' }])
  })
})
