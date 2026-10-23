// ---------------------------------------------------------------------------
// LaborModule (Operations → Labor) test: list + search, New crew, the crew
// detail drawer (edit, service areas, packers, remove) and legible errors.
//
// `@/api/client` is mocked by URL against a small in-memory company list;
// queries and mutations run for real under a fresh QueryClient.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { LaborCrew, LaborCrewDetail, LaborPacker } from '@/api/queries/labor'

const { apiFetchMock, paginatedMock, notifySuccessMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  paginatedMock: vi.fn(),
  notifySuccessMock: vi.fn(),
}))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/api/client')
  return { ...actual, apiFetch: apiFetchMock, apiFetchPaginated: paginatedMock }
})
vi.mock('../components/Snackbar/notify', () => ({
  notifySuccess: notifySuccessMock,
  notifyError: vi.fn(),
  notify: vi.fn(),
}))

import { ApiError } from '@/api/client'
import { LaborModule } from './LaborModule'

const PACKER: LaborPacker = {
  id: 'p1',
  firstName: 'Pat',
  lastName: 'Packer',
  email: 'pat@x.test',
  cidNumber: null,
  cidIssuedOn: null,
  phone: null,
  phoneDisplay: null,
  updatedAt: '2026-10-20T00:00:00Z',
}

function crew(over: Partial<LaborCrewDetail> = {}): LaborCrewDetail {
  return {
    phone: '+14175550101',
    phoneDisplay: '(417) 555-0101',
    name: 'Alpha Movers',
    nickname: null,
    companyNickname: null,
    displayName: 'Alpha Movers',
    email: 'alpha@x.test',
    serviceAreas: [{ id: 'a1', city: 'Springfield', region: 'MO', country: 'US', geocoded: true }],
    packerCount: 1,
    myRating: null,
    averageRating: { average: 4.25, count: 4 },
    addedAt: '2026-10-01T00:00:00Z',
    inMyList: false,
    inCompanyList: true,
    canRemoveFromCompany: true,
    packers: [PACKER],
    ...over,
  }
}

const ALPHA = crew()
const BRAVO = crew({
  phone: '+12145550202',
  phoneDisplay: '(214) 555-0202',
  name: 'Bravo Labor',
  companyNickname: 'Bravo Crew',
  displayName: 'Bravo Crew',
  serviceAreas: [],
  packerCount: 0,
  averageRating: null,
  packers: [],
})

let crews: LaborCrewDetail[]
let listMeta: Record<string, unknown>

const summary = ({ packers: _p, ...rest }: LaborCrewDetail): LaborCrew => rest

beforeEach(() => {
  crews = [ALPHA, BRAVO]
  listMeta = { location: null }
  apiFetchMock.mockReset()
  paginatedMock.mockReset()
  notifySuccessMock.mockReset()

  paginatedMock.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith('/api/v1/labor/company/crews?q=')) {
      const q = decodeURIComponent(path.split('q=')[1] ?? '').toLowerCase()
      const data = crews
        .filter((c) => !q || c.displayName.toLowerCase().includes(q))
        .map(summary)
        .map((c, i) => (listMeta.withDistance ? { ...c, distanceMiles: i === 0 ? 12.4 : null } : c))
      return { data, meta: listMeta }
    }
    if (path === '/api/v1/labor/company/crews' && init?.method === 'POST') {
      throw new Error('POST handled by the test')
    }
    throw new Error(`unexpected paginated ${path}`)
  })

  apiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const m = /\/labor\/(?:company\/)?crews\/([^/?]+)/.exec(path)
    const phone = m ? decodeURIComponent(m[1]!) : null
    const found = crews.find((c) => c.phone === phone)
    if (path.startsWith('/api/v1/labor/places')) {
      return [
        { city: 'Springfield', region: 'MO', country: 'US' },
        { city: 'Springfield', region: 'IL', country: 'US' },
      ]
    }
    if (!found) throw new ApiError('Crew not on the company list', 'CREW_NOT_FOUND', 404)
    if (method === 'GET' && !path.includes('/packers')) return found
    if (method === 'PATCH' && path.includes('/company/crews/')) {
      const body = JSON.parse(init!.body as string)
      const next = { ...found, ...body }
      if ('nickname' in body) {
        next.companyNickname = body.nickname
        next.displayName = body.nickname ?? next.name
        delete next.nickname
      }
      crews = crews.map((c) => (c.phone === phone ? next : c))
      return next
    }
    if (method === 'DELETE' && path.includes('/company/crews/')) {
      crews = crews.filter((c) => c.phone !== phone)
      return null
    }
    if (method === 'PUT' && path.endsWith('/service-areas')) {
      const body = JSON.parse(init!.body as string)
      const next = {
        ...found,
        serviceAreas: body.serviceAreas.map((a: { city: string; region: string }, i: number) => ({
          id: `n${i}`,
          ...a,
          country: 'US',
          geocoded: true,
        })),
      }
      crews = crews.map((c) => (c.phone === phone ? next : c))
      return next
    }
    if (method === 'POST' && path.endsWith('/packers')) {
      const body = JSON.parse(init!.body as string)
      const packer = { ...PACKER, id: 'p2', ...body }
      crews = crews.map((c) =>
        c.phone === phone ? { ...c, packers: [...c.packers, packer], packerCount: 2 } : c,
      )
      return packer
    }
    if (method === 'DELETE' && path.includes('/packers/')) {
      crews = crews.map((c) => (c.phone === phone ? { ...c, packers: [], packerCount: 0 } : c))
      return null
    }
    throw new Error(`unexpected ${method} ${path}`)
  })
})

function renderModule() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <LaborModule />
    </QueryClientProvider>,
  )
}

const callsTo = (method: string, fragment: string) =>
  apiFetchMock.mock.calls.filter(
    ([p, init]) => (init?.method ?? 'GET') === method && String(p).includes(fragment),
  )

describe('LaborModule — list and search', () => {
  it('lists the company crews with their shared name, areas, packers and rating', async () => {
    renderModule()

    const rows = await screen.findAllByTestId('labor-crew-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('Alpha Movers')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('(417) 555-0101')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Springfield, MO')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('4.3 (4)')).toBeInTheDocument()
    // The shared name shows under a company nickname, and only then.
    expect(within(rows[1]!).getByText('Bravo Crew')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Bravo Labor')).toBeInTheDocument()
    expect(within(rows[0]!).queryAllByText('Alpha Movers')).toHaveLength(1)
    expect(screen.queryByText('Distance')).not.toBeInTheDocument()
  })

  it('searches after a debounce, sending the text to the API', async () => {
    const user = userEvent.setup()
    renderModule()
    await screen.findAllByTestId('labor-crew-row')

    await user.type(screen.getByTestId('labor-search'), 'bravo')

    await waitFor(() => expect(screen.getAllByTestId('labor-crew-row')).toHaveLength(1))
    expect(screen.getByText('Bravo Crew')).toBeInTheDocument()
    const paths = paginatedMock.mock.calls.map(([p]) => p as string)
    expect(paths).toContain('/api/v1/labor/company/crews?q=bravo')
    // Debounced: no request per keystroke.
    expect(paths.filter((p) => p.includes('q=b')).length).toBeLessThan(5)
  })

  it('shows a Distance column and the location when a location search is active', async () => {
    listMeta = { location: { label: 'Springfield, MO' }, withDistance: true }
    renderModule()

    expect(await screen.findAllByText('12 mi')).toHaveLength(1)
    // A crew with no geocoded service area has no distance — never "0 mi".
    expect(screen.queryByText('0 mi')).not.toBeInTheDocument()
    expect(screen.getByText('Distance')).toBeInTheDocument()
    expect(screen.getByTestId('labor-location')).toHaveTextContent('Springfield, MO')
  })

  it('says so when a location was not found', async () => {
    listMeta = { location: null, locationNotFound: true }
    renderModule()

    expect(await screen.findByText(/No match for that location/)).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    crews = []
    renderModule()
    expect(await screen.findByText('No crews on the company list')).toBeInTheDocument()
  })

  it('shows a list error legibly', async () => {
    paginatedMock.mockRejectedValue(new ApiError('Boom', 'INTERNAL_ERROR', 500))
    renderModule()
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom')
  })
})

describe('LaborModule — New crew', () => {
  async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTestId('labor-new-crew'))
    await user.type(screen.getByLabelText('Phone'), '417-555-0303')
    await user.type(screen.getByLabelText('Name'), 'Charlie Crew')
    await user.type(screen.getByLabelText('Company nickname (optional)'), 'Charlie')
    await user.click(screen.getByRole('button', { name: 'Add crew' }))
  }

  it('creates a crew, toasts, and opens its detail', async () => {
    const user = userEvent.setup()
    const charlie = crew({
      phone: '+14175550303',
      phoneDisplay: '(417) 555-0303',
      name: 'Charlie Crew',
      companyNickname: 'Charlie',
      displayName: 'Charlie',
      packers: [],
      packerCount: 0,
    })
    paginatedMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        crews = [...crews, charlie]
        return { data: charlie, meta: { outcome: 'added' } }
      }
      return { data: crews.map(summary), meta: { location: null } }
    })
    renderModule()
    await screen.findAllByTestId('labor-crew-row')

    await fillAndSubmit(user)

    await waitFor(() =>
      expect(notifySuccessMock).toHaveBeenCalledWith('Added Charlie to the company list.'),
    )
    const post = paginatedMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({
      phone: '417-555-0303',
      name: 'Charlie Crew',
      nickname: 'Charlie',
    })
    expect(await screen.findByTestId('labor-detail-drawer')).toBeInTheDocument()
    expect(screen.queryByTestId('labor-new-crew-dialog')).not.toBeInTheDocument()
  })

  it('explains linkedExisting: the shared name stands and the typed name is the nickname', async () => {
    const user = userEvent.setup()
    const existing = crew({
      phone: '+14175550303',
      phoneDisplay: '(417) 555-0303',
      name: 'Charles Crewe',
      companyNickname: 'Charlie Crew',
      displayName: 'Charlie Crew',
    })
    paginatedMock.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? { data: existing, meta: { outcome: 'linkedExisting' } }
        : { data: crews.map(summary), meta: { location: null } },
    )
    renderModule()
    await screen.findAllByTestId('labor-crew-row')

    await fillAndSubmit(user)

    const notice = await screen.findByTestId('labor-new-crew-notice')
    expect(notice).toHaveTextContent('already exists on Pegasus')
    expect(notice).toHaveTextContent('"Charles Crewe" stands')
    expect(notice).toHaveTextContent('nickname for it is "Charlie Crew", the name you typed')
    expect(screen.getByRole('button', { name: 'View crew' })).toBeInTheDocument()
  })

  it('says a crew is already in the list', async () => {
    const user = userEvent.setup()
    paginatedMock.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? { data: ALPHA, meta: { outcome: 'alreadyInList' } }
        : { data: crews.map(summary), meta: { location: null } },
    )
    renderModule()
    await screen.findAllByTestId('labor-crew-row')

    await fillAndSubmit(user)

    expect(await screen.findByTestId('labor-new-crew-notice')).toHaveTextContent(
      'Alpha Movers is already on the company list',
    )
  })

  it.each([
    ['LINK_RATE_LIMITED', 429, 'Too many new crews were added recently'],
    ['OPERATIONS_ONLY', 403, 'Only Operations roles can do that.'],
    ['INVALID_PHONE_NUMBER', 400, 'Not a phone number'],
  ])('shows %s legibly', async (code, status, text) => {
    const user = userEvent.setup()
    paginatedMock.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new ApiError('Not a phone number', code, status)
      return { data: crews.map(summary), meta: { location: null } }
    })
    renderModule()
    await screen.findAllByTestId('labor-crew-row')

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    // The form stays open with what was typed.
    expect(screen.getByLabelText('Phone')).toHaveValue('417-555-0303')
  })
})

describe('LaborModule — crew detail', () => {
  async function openAlpha(user: ReturnType<typeof userEvent.setup>) {
    renderModule()
    await user.click(await screen.findByRole('button', { name: 'Alpha Movers' }))
    return await screen.findByTestId('labor-detail-drawer')
  }

  it('edits name, email and company nickname through the company PATCH route', async () => {
    const user = userEvent.setup()
    await openAlpha(user)

    const nickname = await screen.findByLabelText('Company nickname')
    await user.type(nickname, 'Team Alpha')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledWith('Crew saved'))
    const [path, init] = callsTo('PATCH', '/company/crews/')[0]!
    expect(path).toBe('/api/v1/labor/company/crews/%2B14175550101')
    // Only what changed is sent.
    expect(JSON.parse(init.body)).toEqual({ nickname: 'Team Alpha' })
    await waitFor(() =>
      expect(screen.getAllByTestId('labor-crew-row')[0]).toHaveTextContent('Team Alpha'),
    )
  })

  it('clears the nickname and email with null', async () => {
    const user = userEvent.setup()
    crews = [crew({ companyNickname: 'Team Alpha', displayName: 'Team Alpha' }), BRAVO]
    renderModule()
    await user.click(await screen.findByRole('button', { name: 'Team Alpha' }))

    await user.clear(await screen.findByLabelText('Company nickname'))
    await user.clear(screen.getByLabelText('Email'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(callsTo('PATCH', '/company/crews/')).toHaveLength(1))
    expect(JSON.parse(callsTo('PATCH', '/company/crews/')[0]![1].body)).toEqual({
      email: null,
      nickname: null,
    })
  })

  it('shows a save error legibly and keeps the edits', async () => {
    const user = userEvent.setup()
    await openAlpha(user)
    const base = apiFetchMock.getMockImplementation()!
    apiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'PATCH')
        throw new ApiError('Name is too long', 'LABOR_FIELD_INVALID', 422)
      return base(path, init)
    })

    const name = await screen.findByLabelText('Name')
    await user.type(name, ' Jr')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Name is too long')
    expect(name).toHaveValue('Alpha Movers Jr')
  })

  it('edits service areas with the city typeahead and saves them in one PUT', async () => {
    const user = userEvent.setup()
    await openAlpha(user)
    expect(await screen.findByTestId('labor-area-list')).toHaveTextContent('Springfield, MO')

    await user.type(screen.getByTestId('labor-area-input'), 'spring')
    const suggestions = await screen.findByTestId('labor-area-suggestions')
    // The city already on the crew is not offered twice.
    expect(within(suggestions).queryByText('Springfield, MO')).not.toBeInTheDocument()
    await user.click(within(suggestions).getByText('Springfield, IL'))
    await user.click(screen.getByRole('button', { name: 'Save service areas' }))

    await waitFor(() => expect(callsTo('PUT', '/service-areas')).toHaveLength(1))
    expect(JSON.parse(callsTo('PUT', '/service-areas')[0]![1].body)).toEqual({
      serviceAreas: [
        { city: 'Springfield', region: 'MO' },
        { city: 'Springfield', region: 'IL' },
      ],
    })
    expect(notifySuccessMock).toHaveBeenCalledWith('Service areas saved')
  })

  it('removes a service area before saving', async () => {
    const user = userEvent.setup()
    await openAlpha(user)

    await user.click(await screen.findByRole('button', { name: 'Remove Springfield, MO' }))
    expect(screen.getByText('No service areas yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save service areas' }))

    await waitFor(() =>
      expect(JSON.parse(callsTo('PUT', '/service-areas')[0]![1].body)).toEqual({
        serviceAreas: [],
      }),
    )
  })

  it('surfaces a 409 service-area conflict', async () => {
    const user = userEvent.setup()
    await openAlpha(user)
    const base = apiFetchMock.getMockImplementation()!
    apiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        throw new ApiError(
          'Someone else just changed these service areas',
          'SERVICE_AREAS_CONFLICT',
          409,
        )
      }
      return base(path, init)
    })

    await user.click(await screen.findByRole('button', { name: 'Remove Springfield, MO' }))
    await user.click(screen.getByRole('button', { name: 'Save service areas' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else just changed')
  })

  it('adds a packer', async () => {
    const user = userEvent.setup()
    await openAlpha(user)
    const list = await screen.findByTestId('labor-packer-list')
    expect(list).toHaveTextContent('Pat Packer')

    await user.click(screen.getByRole('button', { name: 'Add packer' }))
    const dialog = await screen.findByTestId('labor-packer-dialog')
    await user.type(within(dialog).getByLabelText('First name'), 'Sam')
    await user.type(within(dialog).getByLabelText('Last name'), 'Sack')
    await user.click(within(dialog).getByRole('button', { name: 'Save packer' }))
    // Needs one of email / phone / CID; caught before the round trip.
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('at least one')
    expect(callsTo('POST', '/packers')).toHaveLength(0)

    await user.type(within(dialog).getByLabelText('Email'), 'sam@x.test')
    await user.click(within(dialog).getByRole('button', { name: 'Save packer' }))

    await waitFor(() => expect(callsTo('POST', '/packers')).toHaveLength(1))
    expect(callsTo('POST', '/packers')[0]![0]).toBe('/api/v1/labor/crews/%2B14175550101/packers')
    expect(JSON.parse(callsTo('POST', '/packers')[0]![1].body)).toMatchObject({
      firstName: 'Sam',
      lastName: 'Sack',
      email: 'sam@x.test',
      cidNumber: null,
    })
    await waitFor(() => expect(screen.queryByTestId('labor-packer-dialog')).not.toBeInTheDocument())
    // The drawer survived its nested dialog closing.
    expect(screen.getByTestId('labor-detail-drawer')).toBeInTheDocument()
  })

  it('edits a packer, sending null to clear a blank field', async () => {
    const user = userEvent.setup()
    await openAlpha(user)
    const base = apiFetchMock.getMockImplementation()!
    apiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'PATCH' && path.includes('/packers/')) return { ...PACKER }
      return base(path, init)
    })

    await user.click(await screen.findByRole('button', { name: 'Edit Pat Packer' }))
    const dialog = await screen.findByTestId('labor-packer-dialog')
    await user.type(within(dialog).getByLabelText('Phone'), '417-555-0404')
    await user.click(within(dialog).getByRole('button', { name: 'Save packer' }))

    await waitFor(() => expect(callsTo('PATCH', '/packers/p1')).toHaveLength(1))
    expect(JSON.parse(callsTo('PATCH', '/packers/p1')[0]![1].body)).toMatchObject({
      firstName: 'Pat',
      email: 'pat@x.test',
      phone: '417-555-0404',
      cidNumber: null,
      cidIssuedOn: null,
    })
  })

  it('shows a duplicate-packer 409 in the dialog', async () => {
    const user = userEvent.setup()
    await openAlpha(user)
    const base = apiFetchMock.getMockImplementation()!
    apiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        throw new ApiError(
          'This crew already has a packer with that last name',
          'PACKER_DUPLICATE',
          409,
        )
      }
      return base(path, init)
    })

    await user.click(await screen.findByRole('button', { name: 'Add packer' }))
    const dialog = await screen.findByTestId('labor-packer-dialog')
    await user.type(within(dialog).getByLabelText('First name'), 'Pat')
    await user.type(within(dialog).getByLabelText('Last name'), 'Packer')
    await user.type(within(dialog).getByLabelText('Email'), 'pat@x.test')
    await user.click(within(dialog).getByRole('button', { name: 'Save packer' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already has a packer')
  })

  it('deletes a packer after a confirm', async () => {
    const user = userEvent.setup()
    await openAlpha(user)

    await user.click(await screen.findByRole('button', { name: 'Delete Pat Packer' }))
    expect(callsTo('DELETE', '/packers/')).toHaveLength(0)
    await user.click(
      within(await screen.findByTestId('labor-confirm-dialog')).getByTestId('labor-confirm-ok'),
    )

    await waitFor(() => expect(callsTo('DELETE', '/packers/p1')).toHaveLength(1))
    expect(await screen.findByText('No packers on this crew.')).toBeInTheDocument()
  })

  it('removes the crew from the company list after a confirm, and closes the drawer', async () => {
    const user = userEvent.setup()
    await openAlpha(user)

    await user.click(await screen.findByRole('button', { name: 'Remove from company list' }))
    const confirm = await screen.findByTestId('labor-confirm-dialog')
    expect(confirm).toHaveTextContent('Remove Alpha Movers from the company list?')
    expect(callsTo('DELETE', '/company/crews/')).toHaveLength(0)
    await user.click(within(confirm).getByTestId('labor-confirm-ok'))

    await waitFor(() => expect(callsTo('DELETE', '/company/crews/')).toHaveLength(1))
    expect(callsTo('DELETE', '/company/crews/')[0]![0]).toBe(
      '/api/v1/labor/company/crews/%2B14175550101',
    )
    await waitFor(() => expect(screen.queryByTestId('labor-detail-drawer')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getAllByTestId('labor-crew-row')).toHaveLength(1))
  })

  it('keeps the confirm open and explains a 403 on remove', async () => {
    const user = userEvent.setup()
    await openAlpha(user)
    const base = apiFetchMock.getMockImplementation()!
    apiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'DELETE')
        throw new ApiError('Only Operations can remove', 'OPERATIONS_ONLY', 403)
      return base(path, init)
    })

    await user.click(await screen.findByRole('button', { name: 'Remove from company list' }))
    const confirm = await screen.findByTestId('labor-confirm-dialog')
    await user.click(within(confirm).getByTestId('labor-confirm-ok'))

    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      'Only Operations roles can do that.',
    )
    expect(screen.getByTestId('labor-detail-drawer')).toBeInTheDocument()
  })

  it('hides Remove when the API says the caller cannot remove', async () => {
    const user = userEvent.setup()
    crews = [crew({ canRemoveFromCompany: false }), BRAVO]
    await openAlpha(user)

    await screen.findByLabelText('Company nickname')
    expect(
      screen.queryByRole('button', { name: 'Remove from company list' }),
    ).not.toBeInTheDocument()
  })
})
