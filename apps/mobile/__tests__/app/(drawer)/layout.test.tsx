import React from 'react'
import type * as ReactModule from 'react'
import type * as ReactNative from 'react-native'
import { render } from '@testing-library/react-native'
import { useRouter, useSegments } from 'expo-router'
import DrawerLayout from '../../../app/(drawer)/_layout'
import { useLaborAccess, type LaborAccess } from '../../../src/auth/laborAccess'

jest.mock('expo-router/drawer', () => {
  const React = jest.requireActual<typeof ReactModule>('react')
  const { Text } = jest.requireActual<typeof ReactNative>('react-native')
  const Drawer = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, React.createElement(Text, null, 'DRAWER'), children)
  Drawer.Screen = () => null
  return { Drawer }
})
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children,
}))
jest.mock('../../../src/context/TripsContext', () => ({
  TripsProvider: ({ children }: { children: React.ReactNode }) => children,
}))
jest.mock('../../../src/components/DrawerContent', () => ({ DrawerContent: () => null }))
jest.mock('../../../src/components/UserMenuButton', () => ({ UserMenuButton: () => null }))
jest.mock('../../../src/auth/laborAccess', () => ({ useLaborAccess: jest.fn() }))

const replace = jest.fn()
const base: LaborAccess = {
  isDriver: false,
  isOperations: false,
  resolved: true,
  pending: false,
  canSeeLabor: false,
  operationsOnly: false,
}
const OPS_ONLY: LaborAccess = {
  ...base,
  isOperations: true,
  canSeeLabor: true,
  operationsOnly: true,
}

function setup(access: Partial<LaborAccess>, segments: string[]) {
  ;(useLaborAccess as jest.Mock).mockReturnValue({ ...base, ...access })
  ;(useSegments as jest.Mock).mockReturnValue(segments)
  return render(<DrawerLayout />)
}

beforeEach(() => {
  ;(useRouter as jest.Mock).mockReturnValue({ replace })
})

describe('DrawerLayout', () => {
  it('sends an Operations-only user from the Dashboard to Labor', () => {
    const { getByText } = setup(OPS_ONLY, ['(drawer)'])
    expect(getByText('DRAWER')).toBeTruthy()
    expect(replace).toHaveBeenCalledWith('/labor')
  })

  it('sends an Operations-only user from My Trips to Labor', () => {
    setup(OPS_ONLY, ['(drawer)', 'trips'])
    expect(replace).toHaveBeenCalledWith('/labor')
  })

  it('sends an Operations-only user from My Itinerary to Labor', () => {
    setup(OPS_ONLY, ['(drawer)', 'itinerary'])
    expect(replace).toHaveBeenCalledWith('/labor')
  })

  it('leaves an Operations-only user on Labor and Messages, and on pushed screens', () => {
    setup(OPS_ONLY, ['(drawer)', 'labor'])
    setup(OPS_ONLY, ['(drawer)', 'messages'])
    setup(OPS_ONLY, ['labor', '[phone]'])
    expect(replace).not.toHaveBeenCalled()
  })

  it('does not redirect a driver, or an Operations user who is also a driver', () => {
    setup({ isDriver: true, canSeeLabor: true }, ['(drawer)'])
    setup({ isDriver: true, isOperations: true, canSeeLabor: true }, ['(drawer)'])
    expect(replace).not.toHaveBeenCalled()
  })

  it('waits for /me/driver rather than flashing the Dashboard for an Operations user', () => {
    const { queryByText } = setup(
      { isOperations: true, canSeeLabor: true, resolved: false, pending: true },
      ['(drawer)'],
    )
    expect(queryByText('DRAWER')).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })

  it('does not wait for anyone else', () => {
    const { getByText } = setup({ resolved: false, pending: true }, ['(drawer)'])
    expect(getByText('DRAWER')).toBeTruthy()
  })

  it('hides nothing from an Operations user when /me/driver failed', () => {
    const { getByText } = setup({ isOperations: true, canSeeLabor: true, resolved: false }, [
      '(drawer)',
    ])
    expect(getByText('DRAWER')).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
  })
})
