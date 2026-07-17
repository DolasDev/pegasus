import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import { parseWorkbook } from '@/lib/parse-400ng-xlsx'
import {
  listTariffVersions,
  importTariff,
  activateTariffVersion,
  type Tariff400ngImportDoc,
  type TariffVersionSummary,
  type TariffVersionStatus,
  type ImportResult,
} from '@/api/tariffs'

// ---------------------------------------------------------------------------
// Tariff import — platform-admin upload of GLOBAL 400NG rate data.
//
// Three-step wizard modelled on tenant-web's DriverImport (pick → review →
// confirm), but for the whole-document contract: the .xlsx is parsed IN THE
// BROWSER into the canonical JSON and POSTed once, rather than looped row by
// row. The raw file never leaves the browser. A pre-parsed .json (e.g. the CLI
// script's output) is accepted as an escape hatch for a year the workbook
// layout drifts past the in-browser parser.
// ---------------------------------------------------------------------------

const inputCls =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground ' +
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring ' +
  'disabled:opacity-50 disabled:cursor-not-allowed'

const primaryBtn =
  'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed'

const secondaryBtn =
  'rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground ' +
  'hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed'

function statusBadgeCls(status: TariffVersionStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-green-100 text-green-800'
    case 'STAGED':
      return 'bg-amber-100 text-amber-800'
    case 'SUPERSEDED':
      return 'bg-muted text-muted-foreground'
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  )
}

// A yyyy-mm-dd date-input value → an ISO datetime at UTC midnight (the schema
// wants z.string().datetime()).
function dateToIso(d: string): string {
  return new Date(`${d}T00:00:00.000Z`).toISOString()
}

type Step = 'pick' | 'review' | 'done'

// ---------------------------------------------------------------------------
// Versions table
// ---------------------------------------------------------------------------

function VersionsTable({
  versions,
  onActivate,
  activatingId,
}: {
  versions: TariffVersionSummary[]
  onActivate: (id: string) => void
  activatingId: string | null
}) {
  if (versions.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
        No tariff versions imported yet. Upload a Baseline Rates workbook above to get started.
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Label</th>
            <th className="px-4 py-2 font-medium">Effective</th>
            <th className="px-4 py-2 font-medium">Rows</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Imported by</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {versions.map((v) => {
            const rows =
              v.counts.zip3s +
              v.counts.serviceAreas +
              v.counts.linehaulRates +
              v.counts.shorthaulRates +
              v.counts.packRates +
              v.counts.unpackRates
            return (
              <tr key={v.id}>
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{v.label}</div>
                  <div className="font-mono text-xs text-muted-foreground">{v.tariffCode}</div>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {formatDate(v.effectiveFrom)} – {formatDate(v.effectiveTo)}
                </td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">
                  {rows.toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${statusBadgeCls(v.status)}`}
                  >
                    {v.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{v.importedBy ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  {v.status === 'STAGED' && (
                    <button
                      className={secondaryBtn}
                      disabled={activatingId !== null}
                      onClick={() => onActivate(v.id)}
                    >
                      {activatingId === v.id ? 'Activating…' : 'Activate'}
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function TariffsPage() {
  const queryClient = useQueryClient()

  const [step, setStep] = useState<Step>('pick')
  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [effectiveTo, setEffectiveTo] = useState('')
  const [doc, setDoc] = useState<Tariff400ngImportDoc | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [imported, setImported] = useState<ImportResult | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)

  const isJson = !!file && file.name.toLowerCase().endsWith('.json')

  const versionsQuery = useQuery({
    queryKey: ['admin-tariffs'],
    queryFn: () => listTariffVersions(),
  })

  const importMutation = useMutation({
    mutationFn: (d: Tariff400ngImportDoc) => importTariff(d),
    onSuccess: (result) => {
      setImported(result)
      setStep('done')
      void queryClient.invalidateQueries({ queryKey: ['admin-tariffs'] })
    },
    onError: (err) =>
      setApiError(err instanceof ApiError ? err.message : 'An unexpected error occurred.'),
  })

  const activateMutation = useMutation({
    mutationFn: (id: string) => activateTariffVersion(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-tariffs'] })
    },
    onError: (err) =>
      setApiError(err instanceof ApiError ? err.message : 'An unexpected error occurred.'),
  })

  function resetWizard() {
    setStep('pick')
    setFile(null)
    setLabel('')
    setEffectiveFrom('')
    setEffectiveTo('')
    setDoc(null)
    setWarnings([])
    setParseError(null)
    setImported(null)
    setApiError(null)
  }

  async function handleParse() {
    setParseError(null)
    if (!file) {
      setParseError('Choose a workbook (.xlsx) or a canonical document (.json) first.')
      return
    }
    setParsing(true)
    try {
      if (isJson) {
        const parsed = JSON.parse(await file.text()) as Tariff400ngImportDoc
        setDoc(parsed)
        setWarnings([])
      } else {
        if (!label.trim()) throw new Error('Label is required.')
        if (!effectiveFrom || !effectiveTo) throw new Error('Both effective dates are required.')
        if (new Date(effectiveFrom) >= new Date(effectiveTo)) {
          throw new Error('Effective-from must be before effective-to.')
        }
        const parsed = await parseWorkbook(await file.arrayBuffer())
        setWarnings(parsed.warnings)
        setDoc({
          schemaVersion: 1,
          tariffCode: '400NG',
          label: label.trim(),
          effectiveFrom: dateToIso(effectiveFrom),
          effectiveTo: dateToIso(effectiveTo),
          zip3s: parsed.zip3s,
          serviceAreas: parsed.serviceAreas,
          linehaulRates: parsed.linehaulRates,
          shorthaulRates: parsed.shorthaulRates,
          packRates: parsed.packRates,
          unpackRates: parsed.unpackRates,
        })
      }
      setStep('review')
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse the file.')
    } finally {
      setParsing(false)
    }
  }

  const counts = doc
    ? [
        ['ZIP3s', doc.zip3s.length],
        ['Service areas', doc.serviceAreas.length],
        ['Linehaul cells', doc.linehaulRates.length],
        ['Shorthaul bands', doc.shorthaulRates.length],
        ['Pack bands', doc.packRates.length],
        ['Unpack rates', doc.unpackRates.length],
      ]
    : []

  return (
    <div className="max-w-5xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-lg font-semibold text-foreground">Tariff import</h1>
        <p className="text-sm text-muted-foreground">
          Import the government-published 400NG Baseline Rates workbook as a new tariff version.
          Rate data is platform-global — every tenant rates against the same active version. Import
          stages a version for review; it only affects live rating once you{' '}
          <strong>activate</strong> it.
        </p>
      </div>

      {/* Import wizard */}
      <section className="rounded-lg border border-border bg-card p-6">
        {/* Step indicator */}
        <div className="mb-4 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className={step === 'pick' ? 'text-foreground' : ''}>1. Choose file</span>
          <span>›</span>
          <span className={step === 'review' ? 'text-foreground' : ''}>2. Review</span>
          <span>›</span>
          <span className={step === 'done' ? 'text-foreground' : ''}>3. Activate</span>
        </div>

        {apiError && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {apiError}
          </div>
        )}

        {step === 'pick' && (
          <div className="space-y-4">
            <Field label="Baseline Rates workbook (.xlsx) or canonical document (.json)">
              <input
                type="file"
                accept=".xlsx,.json"
                aria-label="Tariff file"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null)
                  setParseError(null)
                }}
                className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted"
              />
            </Field>

            {!isJson && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Label">
                  <input
                    className={inputCls}
                    aria-label="Label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="2026 400NG Baseline Rates"
                  />
                </Field>
                <Field label="Effective from">
                  <input
                    type="date"
                    aria-label="Effective from"
                    className={inputCls}
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                  />
                </Field>
                <Field label="Effective to">
                  <input
                    type="date"
                    aria-label="Effective to"
                    className={inputCls}
                    value={effectiveTo}
                    onChange={(e) => setEffectiveTo(e.target.value)}
                  />
                </Field>
              </div>
            )}

            {isJson && (
              <p className="text-xs text-muted-foreground">
                A canonical <span className="font-mono">.json</span> already carries its own label
                and effective window — those fields are read from the file.
              </p>
            )}

            {parseError && <p className="text-sm text-destructive">{parseError}</p>}

            <div className="flex justify-end">
              <button className={primaryBtn} onClick={handleParse} disabled={parsing || !file}>
                {parsing ? 'Parsing…' : 'Parse & preview'}
              </button>
            </div>
          </div>
        )}

        {step === 'review' && doc && (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{doc.label}</p>
              <p className="text-xs text-muted-foreground">
                Effective {formatDate(doc.effectiveFrom)} – {formatDate(doc.effectiveTo)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {counts.map(([name, n]) => (
                <div key={name} className="rounded-md border border-border bg-background px-3 py-2">
                  <div className="text-lg font-semibold tabular-nums text-foreground">
                    {Number(n).toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">{name}</div>
                </div>
              ))}
            </div>

            {warnings.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <p className="mb-1 font-medium">
                  {warnings.length} parse warning{warnings.length === 1 ? '' : 's'} — verify before
                  activating:
                </p>
                <ul className="list-inside list-disc space-y-0.5 text-xs">
                  {warnings.slice(0, 10).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                  {warnings.length > 10 && <li>…and {warnings.length - 10} more.</li>}
                </ul>
              </div>
            )}

            <div className="flex justify-between">
              <button
                className={secondaryBtn}
                onClick={resetWizard}
                disabled={importMutation.isPending}
              >
                Back
              </button>
              <button
                className={primaryBtn}
                onClick={() => {
                  setApiError(null)
                  importMutation.mutate(doc)
                }}
                disabled={importMutation.isPending}
              >
                {importMutation.isPending ? 'Importing…' : 'Import (stage version)'}
              </button>
            </div>
          </div>
        )}

        {step === 'done' && imported && (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-background px-4 py-3 text-sm">
              <p className="font-medium text-foreground">
                {imported.created
                  ? 'Version staged.'
                  : 'This exact data was already imported — existing version reused.'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Version <span className="font-mono">{imported.id}</span> — status{' '}
                <span className="font-medium">{imported.status}</span>. Activate it below (or from
                the versions table) to make it the live tariff.
              </p>
            </div>

            <div className="flex justify-between">
              <button className={secondaryBtn} onClick={resetWizard}>
                Import another
              </button>
              {imported.status === 'STAGED' && (
                <button
                  className={primaryBtn}
                  onClick={() => {
                    setApiError(null)
                    activateMutation.mutate(imported.id, { onSuccess: () => resetWizard() })
                  }}
                  disabled={activateMutation.isPending}
                >
                  {activateMutation.isPending ? 'Activating…' : 'Activate now'}
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Existing versions */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Tariff versions</h2>
        {versionsQuery.isPending && (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading versions…</div>
        )}
        {versionsQuery.isError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {versionsQuery.error instanceof Error
              ? versionsQuery.error.message
              : 'Failed to load tariff versions.'}
          </div>
        )}
        {versionsQuery.data && (
          <VersionsTable
            versions={versionsQuery.data}
            onActivate={(id) => {
              setApiError(null)
              activateMutation.mutate(id)
            }}
            activatingId={activateMutation.isPending ? (activateMutation.variables ?? null) : null}
          />
        )}
      </section>
    </div>
  )
}
