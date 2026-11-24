import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DriverEtaCard } from '..'

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/api/client')
  return { ...actual, apiFetch: mockApiFetch }
})

function settings(driverEtaSubmission?: boolean | null) {
  return {
    dashboard: {},
    moves: {},
    quotes: {},
    customers: {},
    dispatch: {},
    billing: {},
    operations: driverEtaSubmission === undefined ? {} : { driverEtaSubmission },
  }
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <DriverEtaCard />
    </QueryClientProvider>,
  )
}

beforeEach(() => mockApiFetch.mockReset())

describe('DriverEtaCard', () => {
  it('shows unchecked when the tenant has never set it (opt-in)', async () => {
    mockApiFetch.mockResolvedValue(settings())
    renderCard()
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled())
    expect(screen.getByTestId('driver-eta-submission')).not.toBeChecked()
    expect(screen.getByTestId('driver-eta-save')).toBeDisabled()
  })

  it('shows checked when the tenant turned it on', async () => {
    mockApiFetch.mockResolvedValue(settings(true))
    renderCard()
    await waitFor(() => expect(screen.getByTestId('driver-eta-submission')).toBeChecked())
  })

  it('PATCHes operations.driverEtaSubmission on save', async () => {
    mockApiFetch.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === 'PATCH' ? settings(true) : settings(false),
    )
    renderCard()
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('driver-eta-submission'))
    fireEvent.click(screen.getByTestId('driver-eta-save'))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/settings/app', {
        method: 'PATCH',
        body: JSON.stringify({ operations: { driverEtaSubmission: true } }),
      }),
    )
    await waitFor(() => expect(screen.getByTestId('driver-eta-save')).toBeDisabled())
    expect(screen.getByTestId('driver-eta-submission')).toBeChecked()
  })
})
