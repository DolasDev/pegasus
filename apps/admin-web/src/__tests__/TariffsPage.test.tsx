import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TariffsPage } from '@/routes/_auth/tariffs/index'
import type { ParsedRates } from '@/lib/parse-400ng-xlsx'

vi.mock('@/lib/parse-400ng-xlsx', () => ({ parseWorkbook: vi.fn() }))
vi.mock('@/api/tariffs', () => ({
  listTariffVersions: vi.fn(),
  importTariff: vi.fn(),
  activateTariffVersion: vi.fn(),
}))

import { parseWorkbook } from '@/lib/parse-400ng-xlsx'
import { listTariffVersions, importTariff, activateTariffVersion } from '@/api/tariffs'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <TariffsPage />
    </QueryClientProvider>,
  )
}

const parsed: ParsedRates = {
  zip3s: [{ zip3: '173', serviceArea: '672' }],
  serviceAreas: [
    {
      serviceArea: '672',
      schedule: 3,
      serviceChargeCentsPerCwt: 1209,
      linehaulFactorCentsPerCwt: 288,
    },
  ],
  linehaulRates: [
    {
      milesLower: 1401,
      milesUpper: 1501,
      weightLower: 8000,
      weightUpper: 8200,
      rateCents: 1_747_500,
    },
  ],
  shorthaulRates: [{ cwtMilesLower: 16_001, cwtMilesUpper: 32_000, rateCents: 39_702 }],
  packRates: [],
  unpackRates: [],
  warnings: [
    'Ambiguous "Included Zip3\'s" at row 8: "21022" — Verify against the source workbook.',
  ],
}

function uploadXlsx(name = 'rates.xlsx') {
  const file = new File(['binary'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  fireEvent.change(screen.getByLabelText('Tariff file'), { target: { files: [file] } })
}

describe('TariffsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listTariffVersions).mockResolvedValue([])
    vi.mocked(parseWorkbook).mockResolvedValue(parsed)
  })

  it('parses a workbook and shows the review step with counts and warnings', async () => {
    renderPage()
    uploadXlsx()
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: '2026 400NG' } })
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2026-05-15' } })
    fireEvent.change(screen.getByLabelText('Effective to'), { target: { value: '2027-05-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Parse & preview' }))

    expect(await screen.findByText('Import (stage version)')).toBeInTheDocument()
    // Counts + warning surfaced.
    expect(screen.getByText('Linehaul cells')).toBeInTheDocument()
    expect(screen.getByText(/1 parse warning/)).toBeInTheDocument()
    expect(parseWorkbook).toHaveBeenCalledOnce()
  })

  it('blocks parse when the effective window is inverted', async () => {
    renderPage()
    uploadXlsx()
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: '2026 400NG' } })
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2027-05-15' } })
    fireEvent.change(screen.getByLabelText('Effective to'), { target: { value: '2026-05-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Parse & preview' }))

    expect(
      await screen.findByText(/Effective-from must be before effective-to/),
    ).toBeInTheDocument()
    expect(parseWorkbook).not.toHaveBeenCalled()
  })

  it('imports the assembled doc and then activates the staged version', async () => {
    vi.mocked(importTariff).mockResolvedValue({ id: 'tv-9', status: 'STAGED', created: true })
    vi.mocked(activateTariffVersion).mockResolvedValue({ id: 'tv-9', status: 'ACTIVE' })

    renderPage()
    uploadXlsx()
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: '2026 400NG' } })
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2026-05-15' } })
    fireEvent.change(screen.getByLabelText('Effective to'), { target: { value: '2027-05-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Parse & preview' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Import (stage version)' }))

    await waitFor(() =>
      expect(importTariff).toHaveBeenCalledWith(
        expect.objectContaining({
          tariffCode: '400NG',
          label: '2026 400NG',
          effectiveFrom: '2026-05-15T00:00:00.000Z',
          effectiveTo: '2027-05-15T00:00:00.000Z',
          zip3s: parsed.zip3s,
        }),
      ),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Activate now' }))
    await waitFor(() => expect(activateTariffVersion).toHaveBeenCalledWith('tv-9'))
  })

  it('reads label/dates from the file for a .json upload (no form fields required)', async () => {
    vi.mocked(importTariff).mockResolvedValue({ id: 'tv-json', status: 'STAGED', created: false })
    const jsonDoc = {
      schemaVersion: 1,
      tariffCode: '400NG',
      label: 'from-json',
      effectiveFrom: '2026-05-15T00:00:00.000Z',
      effectiveTo: '2027-05-15T00:00:00.000Z',
      zip3s: parsed.zip3s,
      serviceAreas: parsed.serviceAreas,
      linehaulRates: parsed.linehaulRates,
      shorthaulRates: parsed.shorthaulRates,
      packRates: [],
      unpackRates: [],
    }
    const file = new File([JSON.stringify(jsonDoc)], 'tariff.json', { type: 'application/json' })

    renderPage()
    fireEvent.change(screen.getByLabelText('Tariff file'), { target: { files: [file] } })
    // No Label/date fields render for .json.
    expect(screen.queryByLabelText('Label')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Parse & preview' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Import (stage version)' }))
    await waitFor(() =>
      expect(importTariff).toHaveBeenCalledWith(expect.objectContaining({ label: 'from-json' })),
    )
    expect(parseWorkbook).not.toHaveBeenCalled()
  })
})
