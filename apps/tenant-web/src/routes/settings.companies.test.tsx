// ---------------------------------------------------------------------------
// Settings → Companies (cloud identity I3): the company list, the per-company
// employee sync, and the admin-facing sync errors.
//
// apiFetch is mocked by URL; queries and mutations run for real under a fresh
// QueryClient.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import { CompaniesSettingsPage, syncErrorMessage } from './settings.companies'

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/api/client')
  return { ...actual, apiFetch: mockApiFetch }
})

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}))

const COMPANY = {
  id: 'co-usa',
  siteId: 'site-1',
  code: 'QMM-USA',
  displayName: 'QMM USA',
  dataSourceKey: 'PegQMMUSA',
  systemEmployeeCode: null,
  isDefault: false,
  isActive: true,
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <CompaniesSettingsPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockApiFetch.mockReset()
  mockApiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/settings/companies') return { sites: [], companies: [COMPANY] }
    if (path.endsWith('/memberships')) {
      return {
        members: [
          {
            id: 'm1',
            tenantUserId: 'u1',
            email: 'jane@qmm.com',
            employeeCode: 1001,
            legacyWindowsUsername: 'jdoe',
            status: 'LINKED',
            matchedBy: 'EMAIL',
            lastSyncedAt: '2026-10-05T12:00:00Z',
          },
        ],
        unmatched: [{ id: 'u2', email: 'nobody@qmm.com', legacyWindowsUsername: null }],
      }
    }
    if (path.endsWith('/membership-sync') && init?.method === 'POST') {
      return {
        employees: 40,
        linked: 1,
        newlyLinked: 1,
        deactivated: 0,
        unmatched: 1,
        ambiguous: 2,
        unmatchedUserIds: ['u2'],
        ambiguousMatches: [],
      }
    }
    throw new Error(`unexpected ${path}`)
  })
})

describe('CompaniesSettingsPage', () => {
  it('lists each company with its database, linked members and unmatched users', async () => {
    renderPage()

    expect(await screen.findByText('QMM USA')).toBeInTheDocument()
    expect(screen.getByText('PegQMMUSA')).toBeInTheDocument()
    expect(await screen.findByText('jane@qmm.com')).toBeInTheDocument()
    expect(screen.getByText('jdoe')).toBeInTheDocument()
    expect(screen.getByText('nobody@qmm.com')).toBeInTheDocument()
  })

  it('syncs one company and reports the summary, including ambiguous matches', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /sync employees/i }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/v1/settings/companies/co-usa/membership-sync',
        { method: 'POST' },
      ),
    )
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('40 employees read')
    expect(status).toHaveTextContent('2 ambiguous (not linked)')
  })
})

describe('syncErrorMessage', () => {
  it.each([
    ['SITE_CLOUD_AUTH_DISABLED', /Cloud auth isn't on/],
    ['SSO_NOT_CONFIGURED', /enabled SSO provider/],
    ['PEGII_CAPABILITY_MISSING', /without the employee directory/],
    ['COMPANY_NOT_FOUND', /SpokeConnections/],
    ['COMPANY_SCHEMA_UNAVAILABLE', /schema migration/],
  ])('explains %s in site terms', (code, text) => {
    expect(syncErrorMessage(new ApiError('raw', code, 503))).toMatch(text)
  })

  it("falls back to the server's message, and a generic one for non-API errors", () => {
    expect(syncErrorMessage(new ApiError('boom', 'OTHER', 500))).toBe('boom')
    expect(syncErrorMessage(new Error('x'))).toBe('Sync failed.')
  })
})
