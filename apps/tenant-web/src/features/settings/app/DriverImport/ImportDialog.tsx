// ---------------------------------------------------------------------------
// ImportDialog — three-step wizard for CSV-driven driver updates.
//
// Step 1: pick a file + toggle "data has headers"
// Step 2: map source columns to driver fields
// Step 3: review match counts and run the per-row mutation
//
// No new backend — every row is matched to an existing driver by its
// `driverId` (the planner-facing "Driver Code" column) and pushed through
// `useUpdateConfirmedAvailability`, the same mutation the Availability
// screen's inline cell edits use.
// ---------------------------------------------------------------------------
import { useMemo, useReducer } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  driverPlanningQueryOptions,
  useUpdateConfirmedAvailability,
} from '@/api/queries/driver-planning'
import { ColumnMapper } from './ColumnMapper'
import {
  coerceRow,
  parseCsv,
  toUpdatePayload,
  TARGETS,
  validateMapping,
  type ColumnMapping,
  type ImportTarget,
  type ParsedCsv,
} from './csv'

type Step = 'pick' | 'map' | 'review'

interface State {
  step: Step
  hasHeaders: boolean
  file: File | null
  parseError: string | null
  parsing: boolean
  parsed: ParsedCsv | null
  mapping: ColumnMapping
  importing: boolean
  /** `null` → not started · running counter while importing · final result. */
  progress: { done: number; total: number } | null
  rowErrors: Array<{ driverId: number; message: string }>
}

const initial: State = {
  step: 'pick',
  hasHeaders: true,
  file: null,
  parseError: null,
  parsing: false,
  parsed: null,
  mapping: [],
  importing: false,
  progress: null,
  rowErrors: [],
}

type Action =
  | { type: 'reset' }
  | { type: 'setHeaders'; value: boolean }
  | { type: 'setFile'; file: File | null }
  | { type: 'parseStart' }
  | { type: 'parseOk'; parsed: ParsedCsv }
  | { type: 'parseFail'; message: string }
  | { type: 'setMapping'; mapping: ColumnMapping }
  | { type: 'goto'; step: Step }
  | { type: 'importStart'; total: number }
  | { type: 'importProgress'; done: number }
  | {
      type: 'importDone'
      errors: Array<{ driverId: number; message: string }>
    }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'reset':
      return initial
    case 'setHeaders':
      // Toggling headers invalidates a parsed view — force re-parse.
      return { ...state, hasHeaders: action.value, parsed: null, mapping: [] }
    case 'setFile':
      return { ...state, file: action.file, parsed: null, mapping: [], parseError: null }
    case 'parseStart':
      return { ...state, parsing: true, parseError: null }
    case 'parseOk':
      return {
        ...state,
        parsing: false,
        parsed: action.parsed,
        mapping: autoMap(action.parsed.columns),
        step: 'map',
      }
    case 'parseFail':
      return { ...state, parsing: false, parseError: action.message }
    case 'setMapping':
      return { ...state, mapping: action.mapping }
    case 'goto':
      return { ...state, step: action.step }
    case 'importStart':
      return {
        ...state,
        importing: true,
        progress: { done: 0, total: action.total },
        rowErrors: [],
      }
    case 'importProgress':
      return {
        ...state,
        progress: state.progress ? { ...state.progress, done: action.done } : null,
      }
    case 'importDone':
      return { ...state, importing: false, rowErrors: action.errors }
  }
}

/** Best-effort default mapping: fuzzy-match each CSV column header against
 *  the import-target label list so the common case (downloaded template) is
 *  one-click. */
function autoMap(columns: string[]): ColumnMapping {
  const used = new Set<ImportTarget>()
  return columns.map((col) => {
    const norm = col.toLowerCase().replace(/[^a-z0-9]/g, '')
    for (const t of TARGETS) {
      if (used.has(t.value)) continue
      const labelNorm = t.label.toLowerCase().replace(/[^a-z0-9]/g, '')
      const valueNorm = t.value.toLowerCase()
      if (norm === labelNorm || norm === valueNorm || norm.includes(valueNorm)) {
        used.add(t.value)
        return t.value
      }
    }
    return null
  })
}

interface Props {
  open: boolean
  onClose: () => void
}

export function ImportDialog({ open, onClose }: Props) {
  const [state, dispatch] = useReducer(reducer, initial)
  const driversQuery = useQuery(driverPlanningQueryOptions)
  const update = useUpdateConfirmedAvailability()

  // Set of valid Driver Codes (driverIds) on this tenant. Built once per dataset.
  const validDriverIds = useMemo(
    () => new Set((driversQuery.data ?? []).map((d) => d.driverId)),
    [driversQuery.data],
  )

  // Step 2 derived state — needs `parsed` to render.
  const validation = useMemo(() => validateMapping(state.mapping), [state.mapping])

  // Step 3 derived state — partition rows into matched / skipped.
  const matched = useMemo(() => {
    if (!state.parsed)
      return {
        hits: [] as Array<{ driverId: number; cells: string[] }>,
        misses: [] as number[],
      }
    const hits: Array<{ driverId: number; cells: string[] }> = []
    const misses: number[] = []
    for (const cells of state.parsed.rows) {
      const row = coerceRow(cells, state.mapping)
      if (!row) continue // row without a valid Driver Code — silently dropped
      if (validDriverIds.has(row.driverId)) {
        hits.push({ driverId: row.driverId, cells })
      } else {
        misses.push(row.driverId)
      }
    }
    return { hits, misses }
  }, [state.parsed, state.mapping, validDriverIds])

  function handleClose() {
    if (state.importing) return
    dispatch({ type: 'reset' })
    onClose()
  }

  async function handleParse() {
    if (!state.file) return
    dispatch({ type: 'parseStart' })
    try {
      const parsed = await parseCsv(state.file, state.hasHeaders)
      dispatch({ type: 'parseOk', parsed })
    } catch (err) {
      dispatch({
        type: 'parseFail',
        message: err instanceof Error ? err.message : 'Failed to read CSV',
      })
    }
  }

  async function handleImport() {
    if (!state.parsed) return
    const total = matched.hits.length
    dispatch({ type: 'importStart', total })
    const errors: Array<{ driverId: number; message: string }> = []
    for (let i = 0; i < matched.hits.length; i++) {
      const { driverId, cells } = matched.hits[i]!
      const row = coerceRow(cells, state.mapping)
      if (!row) continue
      try {
        await update.mutateAsync(toUpdatePayload(row))
      } catch (err) {
        errors.push({
          driverId,
          message: err instanceof Error ? err.message : 'unknown error',
        })
      }
      dispatch({ type: 'importProgress', done: i + 1 })
    }
    dispatch({ type: 'importDone', errors })
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(720px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg"
          aria-describedby="driver-import-description"
        >
          <Dialog.Title asChild>
            <h2 className="text-lg font-semibold">Import drivers from CSV</h2>
          </Dialog.Title>
          <p id="driver-import-description" className="mt-1 text-sm text-muted-foreground">
            Match rows to existing drivers by their <strong>Driver Code</strong> and update
            availability fields. Rows whose Driver Code doesn't exist on this tenant are skipped;
            new drivers are not created.
          </p>

          <div className="mt-4 min-h-[280px]">
            {state.step === 'pick' && (
              <PickStep
                file={state.file}
                hasHeaders={state.hasHeaders}
                parsing={state.parsing}
                error={state.parseError}
                onFile={(f) => dispatch({ type: 'setFile', file: f })}
                onHeaders={(v) => dispatch({ type: 'setHeaders', value: v })}
              />
            )}

            {state.step === 'map' && state.parsed && (
              <MapStep
                parsed={state.parsed}
                mapping={state.mapping}
                validation={validation}
                onChange={(m) => dispatch({ type: 'setMapping', mapping: m })}
              />
            )}

            {state.step === 'review' && state.parsed && (
              <ReviewStep
                total={state.parsed.rows.length}
                hits={matched.hits.length}
                misses={matched.misses}
                progress={state.progress}
                rowErrors={state.rowErrors}
                done={!state.importing && state.progress !== null}
              />
            )}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            {state.step !== 'pick' && !state.importing && state.progress === null && (
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  dispatch({ type: 'goto', step: state.step === 'map' ? 'pick' : 'map' })
                }
              >
                Back
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={state.importing}
            >
              {state.progress !== null && !state.importing ? 'Close' : 'Cancel'}
            </Button>
            {state.step === 'pick' && (
              <Button
                type="button"
                onClick={handleParse}
                disabled={!state.file || state.parsing}
                data-testid="driver-import-next"
              >
                {state.parsing ? 'Reading…' : 'Next'}
              </Button>
            )}
            {state.step === 'map' && (
              <Button
                type="button"
                onClick={() => dispatch({ type: 'goto', step: 'review' })}
                disabled={!validation.ok}
                data-testid="driver-import-preview"
              >
                Preview
              </Button>
            )}
            {state.step === 'review' && state.progress === null && (
              <Button
                type="button"
                onClick={handleImport}
                disabled={matched.hits.length === 0 || driversQuery.isLoading}
                data-testid="driver-import-run"
              >
                {`Import ${matched.hits.length} row${matched.hits.length === 1 ? '' : 's'}`}
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ---------------------------------------------------------------------------
// Step subcomponents
// ---------------------------------------------------------------------------

function PickStep({
  file,
  hasHeaders,
  parsing,
  error,
  onFile,
  onHeaders,
}: {
  file: File | null
  hasHeaders: boolean
  parsing: boolean
  error: string | null
  onFile: (f: File | null) => void
  onHeaders: (v: boolean) => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium" htmlFor="driver-import-file">
          CSV file
        </label>
        <input
          id="driver-import-file"
          data-testid="driver-import-file"
          type="file"
          accept=".csv,text/csv"
          disabled={parsing}
          className="mt-2 block w-full text-sm"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        {file && (
          <p className="mt-1 text-xs text-muted-foreground">
            {file.name} · {Math.round(file.size / 1024)} KB
          </p>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          data-testid="driver-import-has-headers"
          checked={hasHeaders}
          onChange={(e) => onHeaders(e.target.checked)}
        />
        Data has headers (use first row as column names)
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

function MapStep({
  parsed,
  mapping,
  validation,
  onChange,
}: {
  parsed: ParsedCsv
  mapping: ColumnMapping
  validation: ReturnType<typeof validateMapping>
  onChange: (next: ColumnMapping) => void
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'} found · map each CSV column to
        a driver field. Required fields are marked with *.
      </p>
      <ColumnMapper
        columns={parsed.columns}
        samples={parsed.rows.slice(0, 3)}
        mapping={mapping}
        onChange={onChange}
      />
      {!validation.ok && (
        <ul className="list-disc pl-5 text-sm text-destructive">
          {validation.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ReviewStep({
  total,
  hits,
  misses,
  progress,
  rowErrors,
  done,
}: {
  total: number
  hits: number
  misses: number[]
  progress: { done: number; total: number } | null
  rowErrors: Array<{ driverId: number; message: string }>
  done: boolean
}) {
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-md border bg-muted/30 p-3">
        <p>
          <strong>{total}</strong> row{total === 1 ? '' : 's'} parsed · <strong>{hits}</strong> will
          update · <strong>{misses.length}</strong> skipped (no matching driver code)
        </p>
      </div>
      {misses.length > 0 && (
        <details className="rounded-md border p-3" data-testid="driver-import-misses">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Show skipped driver codes ({misses.length})
          </summary>
          <p className="mt-2 break-all font-mono text-xs">{misses.join(', ')}</p>
        </details>
      )}
      {progress && (
        <p className="text-sm" data-testid="driver-import-progress">
          {done
            ? `Done — updated ${progress.done - rowErrors.length} of ${progress.total} drivers.`
            : `Importing ${progress.done} of ${progress.total}…`}
        </p>
      )}
      {rowErrors.length > 0 && (
        <div className="rounded-md border border-destructive/40 p-3 text-destructive">
          <p className="text-sm font-medium">{rowErrors.length} row(s) failed</p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {rowErrors.slice(0, 10).map((e, i) => (
              <li key={i}>
                Driver Code {e.driverId}: {e.message}
              </li>
            ))}
            {rowErrors.length > 10 && <li>…and {rowErrors.length - 10} more</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
