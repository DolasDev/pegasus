import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TenantFormDialog } from '../components/TenantFormDialog'
import type { TenantDetail } from '../api/tenants'

vi.mock('@/api/tenants', () => ({
  createTenant: vi.fn(),
  updateTenant: vi.fn(),
}))

import { createTenant } from '@/api/tenants'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
}

function renderCreate(onClose = vi.fn()) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <TenantFormDialog mode="create" onClose={onClose} />
    </QueryClientProvider>,
  )
}

function makeTenant(overrides: Partial<TenantDetail> = {}): TenantDetail {
  return {
    id: 'tenant-1',
    name: 'Acme Moving Co.',
    slug: 'acme-moving',
    status: 'ACTIVE',
    plan: 'STARTER',
    contactName: null,
    contactEmail: null,
    emailDomains: ['acme.com'],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TenantFormDialog (create mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the "Create tenant" dialog with name and slug fields', () => {
    renderCreate()

    expect(screen.getByRole('heading', { name: 'Create tenant' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Acme Moving Co.')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('acme-moving')).toBeInTheDocument()
  })

  it('submit button is disabled when required fields are empty', () => {
    renderCreate()

    const submitButton = screen.getByRole('button', { name: 'Create tenant' })
    expect(submitButton).toBeDisabled()
  })

  it('calls createTenant mutation on valid submit', async () => {
    vi.mocked(createTenant).mockResolvedValue(makeTenant())
    renderCreate()

    // Fill in all required fields
    fireEvent.change(screen.getByPlaceholderText('Acme Moving Co.'), {
      target: { value: 'Acme Moving Co.' },
    })
    // slug is auto-derived from name; override it to ensure it's valid
    fireEvent.change(screen.getByPlaceholderText('acme-moving'), {
      target: { value: 'acme-moving' },
    })
    fireEvent.change(screen.getByPlaceholderText('admin@acme.com'), {
      target: { value: 'admin@acme.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('acme.com, acme.co.uk'), {
      target: { value: 'acme.com' },
    })

    fireEvent.submit(screen.getByRole('button', { name: 'Create tenant' }).closest('form')!)

    await waitFor(() => {
      expect(vi.mocked(createTenant)).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Acme Moving Co.',
          slug: 'acme-moving',
          adminEmail: 'admin@acme.com',
          emailDomains: ['acme.com'],
        }),
      )
    })
  })

  it('closes the dialog after successful submit', async () => {
    vi.mocked(createTenant).mockResolvedValue(makeTenant())
    const onClose = vi.fn()
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <TenantFormDialog mode="create" onClose={onClose} />
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByPlaceholderText('Acme Moving Co.'), {
      target: { value: 'Acme Moving Co.' },
    })
    fireEvent.change(screen.getByPlaceholderText('acme-moving'), {
      target: { value: 'acme-moving' },
    })
    fireEvent.change(screen.getByPlaceholderText('admin@acme.com'), {
      target: { value: 'admin@acme.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('acme.com, acme.co.uk'), {
      target: { value: 'acme.com' },
    })

    fireEvent.submit(screen.getByRole('button', { name: 'Create tenant' }).closest('form')!)

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })
})
