import React from 'react'
import type * as ReactModule from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import TodoScreen from '../../../app/(drawer)/todo'
import type { DriverTask, DriverTasksMeta } from '../../../src/types/tasks'

const mockSetDone = jest.fn()
jest.mock('../../../src/services/itineraryService', () => ({
  ItineraryService: { setDone: (...args: unknown[]) => mockSetDone(...args) },
}))
const mockSnooze = jest.fn()
jest.mock('../../../src/services/taskService', () => ({
  TaskService: { snooze: (...args: unknown[]) => mockSnooze(...args) },
  snoozeUntilTomorrow: () => new Date('2026-11-17T11:00:00Z'),
}))

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  // Run the focus effect once, like a first visit.
  useFocusEffect: (cb: () => void) => {
    const React = jest.requireActual<typeof ReactModule>('react')
    React.useEffect(cb, [])
  },
}))

// The upload modal is exercised on its own; here only its props matter.
const mockModal = jest.fn()
jest.mock('../../../src/components/AddDocumentModal', () => ({
  AddDocumentModal: (props: Record<string, unknown>) => {
    mockModal(props)
    return null
  },
}))

const mockRefresh = jest.fn()
let mockState: {
  tasks: DriverTask[]
  meta: DriverTasksMeta | null
  enabled: boolean
  loading: boolean
  error: string | null
}
jest.mock('../../../src/context/TasksContext', () => ({
  useTasks: () => ({ ...mockState, dueCount: 0, refresh: mockRefresh }),
}))

const META: DriverTasksMeta = {
  today: '2026-11-16',
  from: '2026-11-02',
  to: '2026-11-16',
  enabledRules: ['submit-arrival-times', 'submit-bol'],
  failedSources: [],
  unavailable: [],
  hidden: 0,
}

const DONE_TASK: DriverTask = {
  key: 'task:submit-arrival-times:100:local-job-token:9:PACK',
  rule: 'submit-arrival-times',
  orderNum: 100,
  shipperName: 'SMITH',
  title: 'Mark Pack done',
  due: '2026-11-15',
  bucket: 'overdue',
  target: { kind: 'mark-done', itemKey: 'local-job-token:9:PACK', day: '2026-11-15' },
}
const BOL_TASK: DriverTask = {
  key: 'task:submit-bol:200:order',
  rule: 'submit-bol',
  orderNum: 200,
  shipperName: 'JONES',
  title: 'Upload the Bill of Lading',
  due: '2026-11-16',
  bucket: 'today',
  target: { kind: 'upload-document', orderNum: 200, documentType: 'bol' },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRefresh.mockResolvedValue(undefined)
  mockState = {
    tasks: [DONE_TASK, BOL_TASK],
    meta: META,
    enabled: true,
    loading: false,
    error: null,
  }
})

describe('TodoScreen', () => {
  it('sections tasks by bucket and order, and refreshes on focus', () => {
    const { getByText } = render(<TodoScreen />)
    expect(getByText('Overdue')).toBeTruthy()
    expect(getByText('Today')).toBeTruthy()
    expect(getByText('SMITH · #100')).toBeTruthy()
    expect(getByText('Upload the Bill of Lading')).toBeTruthy()
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it("marks an act done with the item's key and listed day, then refreshes", async () => {
    mockSetDone.mockResolvedValue({})
    const { getByLabelText } = render(<TodoScreen />)
    fireEvent.press(getByLabelText('Mark Pack done, order 100'))
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(2))
    expect(mockSetDone).toHaveBeenCalledWith(
      { key: 'local-job-token:9:PACK', day: '2026-11-15' },
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    )
  })

  it('opens the upload modal with the document type preset', () => {
    const { getByLabelText } = render(<TodoScreen />)
    fireEvent.press(getByLabelText('Upload the Bill of Lading, order 200'))
    expect(mockModal).toHaveBeenLastCalledWith(
      expect.objectContaining({ visible: true, orderNum: 200, initialType: 'bol' }),
    )
  })

  it('snoozes until tomorrow', async () => {
    mockSnooze.mockResolvedValue(undefined)
    const { getByLabelText } = render(<TodoScreen />)
    fireEvent.press(getByLabelText('Later: Upload the Bill of Lading, order 200'))
    await waitFor(() =>
      expect(mockSnooze).toHaveBeenCalledWith(
        'task:submit-bol:200:order',
        new Date('2026-11-17T11:00:00Z'),
      ),
    )
  })

  it('opens the order from its card', () => {
    const { getByLabelText } = render(<TodoScreen />)
    fireEvent.press(getByLabelText('Open order 100'))
    expect(mockPush).toHaveBeenCalledWith('/shipment/100')
  })

  it('warns when the list is partial', () => {
    mockState.meta = { ...META, unavailable: ['documents'] }
    const { getByText } = render(<TodoScreen />)
    expect(getByText(/may be missing tasks/)).toBeTruthy()
  })

  it('says when the tenant has not turned it on', () => {
    mockState = { ...mockState, tasks: [], enabled: false, meta: { ...META, enabledRules: [] } }
    expect(render(<TodoScreen />).getByText('To Do is off')).toBeTruthy()
  })

  it('says all caught up, counting snoozed tasks', () => {
    mockState = { ...mockState, tasks: [], meta: { ...META, hidden: 2 } }
    expect(render(<TodoScreen />).getByText('Nothing to do now (2 snoozed).')).toBeTruthy()
  })
})
