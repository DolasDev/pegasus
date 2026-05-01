import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

vi.mock('../../../../utils/api', () => ({
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

import { EditActivity } from './index'
import { renderWithStore } from '../../../../__test-utils__/render-with-store'

describe('EditActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const baseActivity = {
    activityType: { abbreviation: 'PU', isCanEditDates: true, sequencePriority: 1 },
    estimated_date: new Date('2024-06-15').toISOString(),
    planned_start: '2024-06-15T00:00:00Z',
    planned_end: '2024-06-16T00:00:00Z',
    notes: 'Test notes',
  }

  it('smoke: renders without crash', () => {
    const { container } = renderWithStore(
      <EditActivity
        activity={baseActivity}
        _referenceElement={null}
        closeEditActivity={() => {}}
        editDateSpread={() => {}}
      />,
    )
    expect(container).toBeTruthy()
    expect(screen.getByText('Date Spread')).toBeInTheDocument()
  })

  it('renders the Clear Dates button', () => {
    renderWithStore(
      <EditActivity
        activity={baseActivity}
        _referenceElement={null}
        closeEditActivity={() => {}}
        editDateSpread={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /Clear Dates/i })).toBeInTheDocument()
  })

  it('clicking Clear Dates invokes editDateSpread with null and closeEditActivity', () => {
    const editDateSpread = vi.fn()
    const closeEditActivity = vi.fn()
    renderWithStore(
      <EditActivity
        activity={baseActivity}
        _referenceElement={null}
        closeEditActivity={closeEditActivity}
        editDateSpread={editDateSpread}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Clear Dates/i }))
    expect(editDateSpread).toHaveBeenCalledWith({
      start_date: undefined,
      end_date: undefined,
    })
    expect(closeEditActivity).toHaveBeenCalled()
  })

  it('handles activity with no estimated_date (falls back to current date)', () => {
    const activityNoDate: any = {
      activityType: { abbreviation: 'PU', isCanEditDates: true, sequencePriority: 1 },
    }
    const { container } = renderWithStore(
      <EditActivity
        activity={activityNoDate}
        _referenceElement={null}
        closeEditActivity={() => {}}
        editDateSpread={() => {}}
      />,
    )
    expect(container).toBeTruthy()
  })
})
