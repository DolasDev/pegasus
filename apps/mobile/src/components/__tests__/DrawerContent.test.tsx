import React from 'react'
import { render, fireEvent } from '@testing-library/react-native'
import { TouchableOpacity } from 'react-native'
import { DrawerContent } from '../DrawerContent'
import { useLaborAccess, type LaborAccess } from '../../auth/laborAccess'

jest.mock('@react-navigation/drawer', () => {
  const React = jest.requireActual('react')
  const { View, TouchableOpacity } = jest.requireActual('react-native')
  return {
    DrawerContentScrollView: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
    DrawerItem: ({ label, onPress }: { label: () => React.ReactNode; onPress: () => void }) =>
      React.createElement(TouchableOpacity, { onPress }, label()),
  }
})
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ session: { email: 'a@b.co' } }),
}))
jest.mock('../../context/TripsContext', () => ({ useTrips: () => ({ offeredCount: 0 }) }))
jest.mock('../../chat/ChatContext', () => ({ useChat: () => ({ unreadTotal: 0 }) }))
jest.mock('../../auth/laborAccess', () => ({ useLaborAccess: jest.fn() }))
const mockTasks = { enabled: false, dueCount: 0 }
jest.mock('../../context/TasksContext', () => ({ useTasks: () => mockTasks }))

const base: LaborAccess = {
  isDriver: false,
  isOperations: false,
  resolved: true,
  pending: false,
  canSeeLabor: false,
  operationsOnly: false,
}
const navigate = jest.fn()
const props = { navigation: { navigate } } as unknown as React.ComponentProps<typeof DrawerContent>

function renderDrawer(access: Partial<LaborAccess>) {
  ;(useLaborAccess as jest.Mock).mockReturnValue({ ...base, ...access })
  return render(<DrawerContent {...props} />)
}

describe('DrawerContent', () => {
  afterEach(() => {
    mockTasks.enabled = false
    mockTasks.dueCount = 0
  })

  it('shows To Do with its due count only when the tenant turned it on', () => {
    expect(renderDrawer({ isDriver: true }).queryByText('To Do')).toBeNull()
    mockTasks.enabled = true
    mockTasks.dueCount = 4
    const { getByText, getByLabelText } = renderDrawer({ isDriver: true })
    expect(getByLabelText('4 tasks due')).toBeTruthy()
    fireEvent.press(getByText('To Do'))
    expect(navigate).toHaveBeenCalledWith('todo')
  })

  it('shows My Itinerary, My Trips, Messages and Labor to a driver', () => {
    const { getByText } = renderDrawer({ isDriver: true, canSeeLabor: true })
    fireEvent.press(getByText('My Itinerary'))
    expect(navigate).toHaveBeenCalledWith('itinerary')
    expect(getByText('My Trips')).toBeTruthy()
    expect(getByText('Messages')).toBeTruthy()
    fireEvent.press(getByText('Labor'))
    expect(navigate).toHaveBeenCalledWith('labor')
  })

  it('shows an Operations-only user just Labor and Messages', () => {
    const { getByText, queryByText } = renderDrawer({
      isOperations: true,
      canSeeLabor: true,
      operationsOnly: true,
    })
    expect(queryByText('My Trips')).toBeNull()
    expect(queryByText('My Itinerary')).toBeNull()
    expect(getByText('Messages')).toBeTruthy()
    expect(getByText('Labor')).toBeTruthy()
  })

  it('keeps My Trips for an Operations user who is also a driver', () => {
    const { getByText } = renderDrawer({ isOperations: true, isDriver: true, canSeeLabor: true })
    expect(getByText('My Trips')).toBeTruthy()
    expect(getByText('Labor')).toBeTruthy()
  })

  it('hides Labor from a user who is neither', () => {
    const { getByText, queryByText } = renderDrawer({})
    expect(queryByText('Labor')).toBeNull()
    expect(getByText('My Trips')).toBeTruthy()
    expect(getByText('Messages')).toBeTruthy()
  })

  it('renders pressable rows', () => {
    const { UNSAFE_getAllByType } = renderDrawer({ isDriver: true, canSeeLabor: true })
    expect(UNSAFE_getAllByType(TouchableOpacity)).toHaveLength(4)
  })
})
