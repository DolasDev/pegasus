import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

vi.mock('../../utils/api', () => ({
  API: {
    saveTrip: vi.fn(),
    fetchTrip: vi.fn(),
    cancelTrip: vi.fn(),
    fetchShipments: vi.fn(() => Promise.resolve([])),
  },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: any) => (
    <a href={typeof to === 'string' ? to : '#'} {...rest}>
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: '/', search: {}, hash: '' }),
  useNavigate: () => () => {},
  useParams: () => ({}),
}))

import { TripDetail, DriverTripDetail, NameTripDetail, DispatcherTripDetail } from './TripDetail'
import { renderWithStore } from '../../__test-utils__/render-with-store'

describe('TripDetail (read-only)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const baseTrip = {
    trip_title: 'Trip A',
    driver: { driver_id: 7, driver_name: 'Sam' },
    shipments: [],
    status: { id: 1, status_id: 1, status: 'Pending' },
    total_weight: '1,200',
    total_price: '$500',
  }

  it('smoke: renders the label and display value', () => {
    renderWithStore(
      <TripDetail
        currentTrip={baseTrip}
        label="Total Weight"
        editLabel="edit"
        displayVal="1,200 LB"
        editTrip={false as any}
        editable={false}
        EditComponent={() => null}
      />,
    )
    expect(screen.getByText('Total Weight')).toBeInTheDocument()
    expect(screen.getByText('1,200 LB')).toBeInTheDocument()
  })

  it('switches to edit mode when "edit" link is clicked, then save invokes editTrip', () => {
    const editTrip = vi.fn()
    const EditComp = ({ value, onChange }: any) => (
      <input
        data-testid="trip-name-input"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
    )
    renderWithStore(
      <TripDetail
        currentTrip={{ ...baseTrip, trip_title: 'Trip A' }}
        label="Trip Name"
        property="trip_title"
        editLabel="edit"
        displayVal="Trip A"
        editTrip={editTrip}
        EditComponent={EditComp}
      />,
    )
    fireEvent.click(screen.getByText('edit'))
    // After clicking edit, "Save" link is visible
    expect(screen.getByText('Save')).toBeInTheDocument()
    // The input is rendered and pre-filled via useEffect
    expect(screen.getByTestId('trip-name-input')).toBeInTheDocument()
    // Click Save
    fireEvent.click(screen.getByText('Save'))
    expect(editTrip).toHaveBeenCalled()
  })
})

describe('DriverTripDetail', () => {
  const baseTrip = {
    trip_title: 'Trip A',
    driver: { driver_id: 7, driver_name: 'Sam' },
    shipments: [],
    status: { id: 1, status_id: 1, status: 'Pending' },
  }

  it('smoke: renders driver edit component (starts in edit mode)', () => {
    const EditComp = ({ value, onChange }: any) => (
      <button
        data-testid="driver-select"
        onClick={() => onChange({ id: 9, driver_id: 9, driver_name: 'Pat' })}
      >
        {value?.label || 'select'}
      </button>
    )
    renderWithStore(
      <DriverTripDetail
        currentTrip={baseTrip}
        label="Driver"
        property="driver"
        editLabel="Change Driver"
        displayVal=""
        editTrip={() => {}}
        EditComponent={EditComp}
      />,
    )
    expect(screen.getByText('Driver')).toBeInTheDocument()
    expect(screen.getByTestId('driver-select')).toBeInTheDocument()
  })

  it('locks the driver field (no typeahead) when the trip is In-Progress', () => {
    const editTrip = vi.fn()
    const EditComp = ({ value, onChange }: any) => (
      <button
        data-testid="driver-select"
        onClick={() => onChange({ id: 9, driver_id: 9, driver_name: 'Pat' })}
      >
        {value?.label || 'select'}
      </button>
    )
    const inProgressTrip = {
      ...baseTrip,
      status: { id: 4, status_id: 4, status: 'In-Progress' },
    }
    renderWithStore(
      <DriverTripDetail
        currentTrip={inProgressTrip}
        label="Driver"
        property="driver"
        editLabel="Change Driver"
        displayVal=""
        editTrip={editTrip}
        EditComponent={EditComp}
      />,
    )
    // Read-only sentinel rendered…
    expect(screen.getByText('Driver')).toBeInTheDocument()
    expect(screen.getByText('Sam')).toBeInTheDocument()
    expect(screen.getByText(/locked — trip in progress/i)).toBeInTheDocument()
    // …and the typeahead EditComponent is NOT rendered.
    expect(screen.queryByTestId('driver-select')).not.toBeInTheDocument()
    expect(editTrip).not.toHaveBeenCalled()
  })

  it('falls back to "Unassigned" when an In-Progress trip has no driver', () => {
    const inProgressTrip = {
      ...baseTrip,
      driver: null,
      status: { id: 4, status_id: 4, status: 'In-Progress' },
    }
    renderWithStore(
      <DriverTripDetail
        currentTrip={inProgressTrip}
        label="Driver"
        property="driver"
        editLabel="Change Driver"
        displayVal=""
        editTrip={() => {}}
        EditComponent={() => null}
      />,
    )
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })

  it('calls editTrip with driver and driver_id when driver changes', () => {
    const editTrip = vi.fn()
    const EditComp = ({ onChange }: any) => (
      <button
        data-testid="driver-select"
        onClick={() => onChange({ id: 9, driver_id: 9, driver_name: 'Pat' })}
      >
        change
      </button>
    )
    renderWithStore(
      <DriverTripDetail
        currentTrip={baseTrip}
        label="Driver"
        property="driver"
        editLabel="Change Driver"
        displayVal=""
        editTrip={editTrip}
        EditComponent={EditComp}
      />,
    )
    fireEvent.click(screen.getByTestId('driver-select'))
    expect(editTrip).toHaveBeenCalledWith(
      expect.objectContaining({
        driver: expect.objectContaining({ driver_id: 9 }),
        driver_id: 9,
      }),
    )
  })
})

describe('NameTripDetail', () => {
  it('smoke: renders an EditComponent in edit mode (initial)', () => {
    const baseTrip = {
      trip_title: 'My Trip',
      driver: null,
      shipments: [],
      status: { id: 1, status_id: 1, status: 'Pending' },
    }
    const EditComp = ({ value, onChange }: any) => (
      <input
        data-testid="name-input"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
    )
    renderWithStore(
      <NameTripDetail
        currentTrip={baseTrip}
        label="Trip Name"
        property="trip_title"
        editLabel="edit"
        displayVal="My Trip"
        editVal="My Trip"
        editTrip={() => {}}
        EditComponent={EditComp}
      />,
    )
    expect(screen.getByText('Trip Name')).toBeInTheDocument()
    expect(screen.getByTestId('name-input')).toBeInTheDocument()
  })

  it('typing into the name input sets actualEditMode (no immediate editTrip dispatch)', () => {
    const editTrip = vi.fn()
    const baseTrip = {
      trip_title: 'My Trip',
      driver: null,
      shipments: [],
      status: { id: 1, status_id: 1, status: 'Pending' },
    }
    const EditComp = ({ value, onChange }: any) => (
      <input
        data-testid="name-input"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
    )
    renderWithStore(
      <NameTripDetail
        currentTrip={baseTrip}
        label="Trip Name"
        property="trip_title"
        editLabel="edit"
        displayVal="My Trip"
        editVal="My Trip"
        editTrip={editTrip}
        EditComponent={EditComp}
      />,
    )
    fireEvent.change(screen.getByTestId('name-input'), { target: { value: 'New Name' } })
    // editTrip is only called via outside-click; not on each keystroke
    expect(editTrip).not.toHaveBeenCalled()
  })
})

describe('DispatcherTripDetail', () => {
  it('smoke: renders dispatcher select using common.dispatcherList from store', () => {
    const dispatcherList = [
      { code: 'D1', first_name: 'Alex', last_name: 'Smith' },
      { code: 'D2', first_name: 'Robin', last_name: 'Doe' },
    ]
    const trip = {
      trip_title: 'X',
      driver: null,
      shipments: [],
      dispatcher: dispatcherList[0],
      status: { id: 1, status_id: 1, status: 'Pending' },
    }
    const { container } = renderWithStore(
      <DispatcherTripDetail
        currentTrip={trip}
        label="Dispatcher"
        property="dispatcher"
        editLabel="Change Dispatcher"
        displayVal="Alex Smith"
        editTrip={() => {}}
      />,
      {
        preloadedState: {
          common: { dispatcherList } as any,
        },
      },
    )
    expect(container).toBeTruthy()
    expect(screen.getByText('Dispatcher')).toBeInTheDocument()
  })

  it('handles missing dispatcher gracefully', () => {
    const trip = {
      trip_title: 'X',
      driver: null,
      shipments: [],
      dispatcher: null,
      status: { id: 1, status_id: 1, status: 'Pending' },
    }
    const { container } = renderWithStore(
      <DispatcherTripDetail
        currentTrip={trip}
        label="Dispatcher"
        property="dispatcher"
        editLabel="Change"
        displayVal=""
        editTrip={() => {}}
      />,
    )
    expect(container).toBeTruthy()
  })
})
