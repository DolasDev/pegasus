// ---------------------------------------------------------------------------
// Crew-link page (`/c/<token>`): the texted-code gate, the job view, packer
// selection and the crew list. The crew-link API calls are mocked; the session
// helpers and CrewLinkError are the real ones.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CrewLinkError, type CrewJob } from '@/api/crew-link'
import { CrewLinkPage } from './c.$token'

const api = vi.hoisted(() => ({
  requestCode: vi.fn(),
  verifyCode: vi.fn(),
  getCrewJob: vi.fn(),
  setActivityPackers: vi.fn(),
  addPacker: vi.fn(),
  updatePacker: vi.fn(),
  removePacker: vi.fn(),
}))

vi.mock('@/api/crew-link', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/api/crew-link')
  return { ...actual, ...api }
})

const TOKEN = `crl_${'a'.repeat(48)}`

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ token: TOKEN }),
}))

const packer = (id: string, firstName: string, lastName: string) => ({
  id,
  firstName,
  lastName,
  email: null,
  cidNumber: null,
  cidIssuedOn: null,
  phone: '+14045559999',
  phoneDisplay: '(404) 555-9999',
  updatedAt: '2026-10-28T00:00:00Z',
})

const JOB: CrewJob = {
  orderNum: 9100,
  crew: { name: 'Peach Crew', phoneDisplay: '(404) 555-0401' },
  weight: { estimated: 8000, actual: null },
  activities: [
    {
      id: 901,
      typeCode: 'PACK',
      typeName: 'Pack',
      plannedStart: '2026-11-02',
      estimatedDate: null,
      actualDate: null,
      arrivalWindow: { start: '08:00', end: '10:00' },
      address: { street: '12 Elm St', unit: null, city: 'Atlanta', state: 'GA', zip: '30301' },
      packerIds: ['p1'],
    },
  ],
  packers: [packer('p1', 'Ana', 'Ruiz'), packer('p2', 'Bo', 'Lee')],
  linkExpiresAt: '2026-11-11T00:00:00Z',
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <CrewLinkPage />
    </QueryClientProvider>,
  )
}

async function signIn() {
  renderPage()
  fireEvent.click(screen.getByRole('button', { name: 'Text me a code' }))
  const input = await screen.findByLabelText('Code')
  fireEvent.change(input, { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

beforeEach(() => {
  sessionStorage.clear()
  for (const fn of Object.values(api)) fn.mockReset()
  api.requestCode.mockResolvedValue({
    sent: true,
    phoneHint: '•••• 0401',
    expiresAt: '2026-10-28T00:10:00Z',
  })
  api.verifyCode.mockResolvedValue({ session: 'crs_session', expiresAt: '2026-10-28T12:00:00Z' })
  api.getCrewJob.mockResolvedValue(JOB)
  api.setActivityPackers.mockImplementation(async (_t, _s, activityId, packerIds) => ({
    activityId,
    packerIds,
  }))
})

describe('CrewLinkPage', () => {
  it('asks for no phone number — it texts the crew phone on file', async () => {
    renderPage()
    expect(screen.queryByLabelText(/phone/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Text me a code' }))
    expect(await screen.findByText(/crew phone ending 0401/)).toBeTruthy()
    expect(api.requestCode).toHaveBeenCalledWith(TOKEN)
  })

  it('verifies the code, keeps the session for this tab, and shows the job', async () => {
    await signIn()
    expect(await screen.findByText('Peach Crew')).toBeTruthy()
    expect(api.verifyCode).toHaveBeenCalledWith(TOKEN, '123456')
    expect(api.getCrewJob).toHaveBeenCalledWith(TOKEN, 'crs_session')
    expect(sessionStorage.getItem(`crew-link-session:${TOKEN}`)).toBe('crs_session')
    expect(screen.getByText('Order 9100')).toBeTruthy()
    expect(screen.getByText('Estimated weight 8,000 lbs')).toBeTruthy()
    expect(screen.getByText('12 Elm St')).toBeTruthy()
    expect(screen.getByText('Atlanta, GA 30301')).toBeTruthy()
    expect(screen.getByText(/Start 08:00/)).toBeTruthy()
  })

  it('shows how many tries are left after a wrong code', async () => {
    api.verifyCode.mockRejectedValueOnce(
      new CrewLinkError("That code isn't right.", 'CODE_INCORRECT', 400, 3),
    )
    await signIn()
    expect(await screen.findByText("That code isn't right. 3 tries left.")).toBeTruthy()
  })

  it('shows the inactive state for a dead link', async () => {
    api.requestCode.mockRejectedValueOnce(new CrewLinkError('gone', 'LINK_INACTIVE', 404))
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Text me a code' }))
    expect(await screen.findByText('This link is no longer active')).toBeTruthy()
  })

  it('explains when the company has no texting set up', async () => {
    api.requestCode.mockRejectedValueOnce(
      new CrewLinkError("Texting isn't set up for this company yet.", 'SMS_UNAVAILABLE', 409),
    )
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Text me a code' }))
    expect(await screen.findByText(/Texting isn't set up/)).toBeTruthy()
  })

  it('goes back to the code step when the stored session has ended', async () => {
    sessionStorage.setItem(`crew-link-session:${TOKEN}`, 'crs_old')
    api.getCrewJob.mockRejectedValueOnce(new CrewLinkError('ended', 'SESSION_EXPIRED', 401))
    renderPage()
    expect(await screen.findByRole('button', { name: 'Text me a code' })).toBeTruthy()
    expect(sessionStorage.getItem(`crew-link-session:${TOKEN}`)).toBeNull()
  })

  it('ticks a packer onto an activity', async () => {
    await signIn()
    const bo = await screen.findByRole('checkbox', { name: 'Bo Lee' })
    expect((screen.getByRole('checkbox', { name: 'Ana Ruiz' }) as HTMLInputElement).checked).toBe(
      true,
    )
    fireEvent.click(bo)
    await waitFor(() =>
      expect(api.setActivityPackers).toHaveBeenCalledWith(TOKEN, 'crs_session', 901, ['p1', 'p2']),
    )
  })

  it('adds a crew member', async () => {
    api.addPacker.mockResolvedValue(packer('p3', 'Cy', 'Day'))
    await signIn()
    fireEvent.click(await screen.findByRole('button', { name: 'Add a crew member' }))
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Cy' } })
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Day' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '404-555-1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to crew' }))
    await waitFor(() =>
      expect(api.addPacker).toHaveBeenCalledWith(TOKEN, 'crs_session', {
        firstName: 'Cy',
        lastName: 'Day',
        phone: '404-555-1234',
        email: null,
        cidNumber: null,
        cidIssuedOn: null,
      }),
    )
  })

  it('asks before removing a crew member', async () => {
    api.removePacker.mockResolvedValue(null)
    await signIn()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Bo Lee' }))
    expect(api.removePacker).not.toHaveBeenCalled()
    const row = screen.getByText('Bo Lee', { selector: 'p' }).closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(api.removePacker).toHaveBeenCalledWith(TOKEN, 'crs_session', 'p2'))
  })
})
