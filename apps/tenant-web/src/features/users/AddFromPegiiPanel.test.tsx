// ---------------------------------------------------------------------------
// Users → "Add from pegII": pick employees, choose roles, optionally send the
// invite. apiFetch is mocked by URL; queries and the mutation run for real.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AddFromPegiiPanel } from './AddFromPegiiPanel'

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/api/client')
  return { ...actual, apiFetch: mockApiFetch }
})

const COMPANIES = {
  sites: [],
  companies: [
    { id: 'co-ca', code: 'QMM-CANADA', displayName: 'QMM Canada', isDefault: true, isActive: true },
    { id: 'co-usa', code: 'QMM-USA', displayName: 'QMM USA', isDefault: false, isActive: true },
  ],
}

const DIRECTORY = [
  {
    code: 7392,
    name: 'B ANDREOPULOS',
    email: 'bandreopulos@qmm.com',
    branch: '01',
    existingUserId: null,
  },
  { code: 7429, name: 'G DHOOPAR', email: 'gdhoopar@qmm.com', branch: '02', existingUserId: 'u-1' },
  { code: 7500, name: 'NO MAIL', email: null, branch: null, existingUserId: null },
  { code: 7501, name: 'C SMITH', email: 'csmith@qmm.com', branch: '02', existingUserId: null },
]

let ssoProviders: Array<{ isEnabled: boolean }> = [{ isEnabled: true }]

function renderPanel(onDone = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <AddFromPegiiPanel
        onDone={onDone}
        roleOptions={[{ name: 'viewer', label: 'Viewer', description: '' }]}
      />
    </QueryClientProvider>,
  )
  return onDone
}

beforeEach(() => {
  ssoProviders = [{ isEnabled: true }]
  mockApiFetch.mockReset()
  mockApiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/settings/companies') return COMPANIES
    if (path === '/api/v1/sso/providers')
      return { providers: ssoProviders, cognitoAuthEnabled: true }
    if (path.endsWith('/directory')) return DIRECTORY
    if (path === '/api/v1/users/import' && init?.method === 'POST') {
      return {
        results: [
          { code: 7392, email: 'bandreopulos@qmm.com', status: 'created', userId: 'n1' },
          {
            code: 7501,
            email: 'csmith@qmm.com',
            status: 'skipped',
            reason: 'ACTIVE_IN_ANOTHER_TENANT',
          },
        ],
        created: 1,
        membershipSync: { linked: 1, newlyLinked: 1, ambiguous: 0 },
      }
    }
    throw new Error(`unexpected ${path}`)
  })
})

describe('AddFromPegiiPanel', () => {
  it("reads the default company's directory and greys out people who can't be added", async () => {
    renderPanel()

    await screen.findByText('B ANDREOPULOS')
    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/settings/companies/co-ca/directory')
    expect(screen.getByLabelText(/G DHOOPAR/)).toBeDisabled()
    expect(screen.getByText('Already a user')).toBeInTheDocument()
    expect(screen.getByLabelText(/NO MAIL/)).toBeDisabled()
    expect(screen.getByText('No email in pegII')).toBeInTheDocument()
    expect(screen.getByLabelText(/B ANDREOPULOS/)).toBeEnabled()
  })

  it('switching company reads that company instead', async () => {
    renderPanel()
    await screen.findByText('B ANDREOPULOS')

    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'co-usa' } })

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/settings/companies/co-usa/directory'),
    )
  })

  it('search filters by name, email, code or branch; select-all takes only addable rows', async () => {
    renderPanel()
    await screen.findByText('B ANDREOPULOS')

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '02' } })
    const list = screen.getByRole('list', { name: 'Employees' })
    expect(within(list).queryByText('B ANDREOPULOS')).not.toBeInTheDocument()
    expect(within(list).getByText('C SMITH')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /select all shown \(1\)/i }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(screen.getByLabelText(/C SMITH/)).toBeChecked()
  })

  it('defaults to SSO-only (no invite) and sends only employee codes', async () => {
    renderPanel()
    await screen.findByText('B ANDREOPULOS')

    expect(screen.getByLabelText('Send invite')).not.toBeChecked()
    fireEvent.click(screen.getByLabelText(/B ANDREOPULOS/))
    fireEvent.click(screen.getByLabelText(/C SMITH/))
    fireEvent.click(screen.getByRole('button', { name: /add 2 users/i }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/users/import', {
        method: 'POST',
        body: JSON.stringify({
          companyId: 'co-ca',
          employeeCodes: [7392, 7501],
          roleNames: ['viewer'],
          sendInvite: false,
        }),
      }),
    )
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('1 user added')
    expect(status).toHaveTextContent('Added — signs in with SSO')
    expect(status).toHaveTextContent('Skipped: already signs in to another Pegasus account')
  })

  it('forces "Send invite" on when the tenant has no enabled SSO provider', async () => {
    ssoProviders = [{ isEnabled: false }]
    renderPanel()
    await screen.findByText('B ANDREOPULOS')

    await waitFor(() => expect(screen.getByLabelText('Send invite')).toBeChecked())
    expect(screen.getByLabelText('Send invite')).toBeDisabled()
    expect(screen.getByText(/SSO is not set up/)).toBeInTheDocument()
  })

  it("explains a site that can't serve the directory", async () => {
    mockApiFetch.mockImplementation(async (path: string) => {
      if (path === '/api/v1/settings/companies') return COMPANIES
      if (path === '/api/v1/sso/providers')
        return { providers: ssoProviders, cognitoAuthEnabled: true }
      const { ApiError } = await import('@/api/client')
      throw new ApiError('raw', 'SITE_CLOUD_AUTH_DISABLED', 409)
    })
    renderPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent(/Cloud auth isn't on/)
    expect(screen.getByRole('button', { name: /add/i })).toBeDisabled()
  })
})
