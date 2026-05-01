import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: any) => <a>{props.children}</a>,
  useLocation: () => ({}),
  useNavigate: () => () => {},
  useParams: () => ({}),
}))

vi.mock('@/features/driver-planning/utils/api', () => ({
  API: {
    createTripNote: vi.fn(async () => ({})),
    patchTripNote: vi.fn(async () => ({})),
  },
}))

import { renderWithStore } from '../../../../__test-utils__/render-with-store'
import { Notes } from './Notes'

const sampleNotes = [
  {
    id: 'n1',
    note: 'First note body',
    createdByUser: { first_name: 'Sam', last_name: 'Iam', email_address: 's@x.com' },
    createdAt: '2024-01-01T12:00:00Z',
    updatedAt: '2024-01-01T12:00:00Z',
  },
  {
    id: 'n2',
    note: 'Second note body',
    createdByUser: { first_name: '', last_name: '', email_address: 'b@x.com' },
    createdAt: '2024-02-01T12:00:00Z',
    updatedAt: '2024-02-01T12:00:00Z',
  },
]

describe('Notes', () => {
  it('renders the notes count in the header', () => {
    renderWithStore(
      <Notes notes={sampleNotes as any} tripId={'1'} reloadTrip={() => {}} />,
    )
    expect(screen.getByText('Notes (2)')).toBeInTheDocument()
  })

  it('renders an "Add Note" button', () => {
    renderWithStore(<Notes notes={[]} tripId={'1'} reloadTrip={() => {}} />)
    expect(screen.getByText('Add Note')).toBeInTheDocument()
  })

  it('renders each note body after expanding the section', () => {
    renderWithStore(
      <Notes notes={sampleNotes as any} tripId={'1'} reloadTrip={() => {}} />,
    )
    // Expandable is collapsed by default; toggle by clicking the title row.
    fireEvent.click(screen.getByText(/Notes \(2\)/))
    expect(screen.getByText('First note body')).toBeInTheDocument()
    expect(screen.getByText('Second note body')).toBeInTheDocument()
  })

  it('opens the New Note modal when Add Note is clicked', () => {
    renderWithStore(<Notes notes={[]} tripId={'1'} reloadTrip={() => {}} />)
    fireEvent.click(screen.getByText('Add Note'))
    // Dialog title appears
    expect(screen.getByText('Add/Edit Note')).toBeInTheDocument()
  })

  it('opens the Edit Note modal when Edit is clicked on a note', () => {
    renderWithStore(
      <Notes notes={sampleNotes as any} tripId={'1'} reloadTrip={() => {}} />,
    )
    fireEvent.click(screen.getByText(/Notes \(2\)/))
    const editButtons = screen.getAllByText('Edit')
    fireEvent.click(editButtons[0])
    expect(screen.getByText('Add/Edit Note')).toBeInTheDocument()
  })
})
