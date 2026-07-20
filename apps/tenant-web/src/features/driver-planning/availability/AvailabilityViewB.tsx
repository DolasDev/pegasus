// ---------------------------------------------------------------------------
// Availability view variant B — planner-oriented driver roster.
//
// One of three parallel copies (A/B/C) wired into routes/driver-planning.index.tsx
// behind a "Change View" tab toggle. Variant B diverges from the move-centric A/C
// into a flat attribute table: a row per driver with planner-maintained fields
// (Canada/California eligibility, rating, equipment, home location, notes) stored
// as manual overrides on DriverConfirmedAvailability, plus derived State/Zone and
// the agency-colored driver name. Edit freely — there is no shared base.
// ---------------------------------------------------------------------------
import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSelector } from 'react-redux'
import { EmptyState } from '@/components/EmptyState'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import {
  driverPlanningQueryOptions,
  useUpdateConfirmedAvailability,
  type DriverPlanningRow,
} from '@/api/queries/driver-planning'
import { HoverToolTip } from '@/features/driver-planning/containers/ToolTips'
import { Select } from '@/features/driver-planning/components/Select'
import type { RootState } from '@/features/driver-planning/redux/store'

const CARD_TEXT_CLASS = 'text-[#0c145c]'
const CARD_ROW_CLASS = `bg-white/30 shadow-sm hover:bg-[#f5f5f5] ${CARD_TEXT_CLASS} font-light`

const AGENCY_PLACEHOLDER = '1111'
const EQUIPMENT_OPTIONS = ['Tractor Trailer', 'Straight Truck']

// Driver-name cell background keyed by agency (agent code). Tunable shades.
const AGENCY_BG: Record<string, string> = {
  '1511': 'bg-red-300',
  '1545': 'bg-orange-300',
  '1505': 'bg-white',
  '1523': 'bg-emerald-200',
  '1295': 'bg-yellow-200',
}

function agencyBgClass(agentCode: string | null): string {
  if (!agentCode) return ''
  return AGENCY_BG[agentCode.trim()] ?? ''
}

function ratingClass(rating: number | null): string {
  return rating != null && rating < 4.5 ? 'bg-red-200 text-red-700' : ''
}

function formatRating(rating: number | null): string {
  return rating == null ? '-' : rating.toFixed(1)
}

function formatMonthDay(dateStr: string | null): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${mm}/${dd}`
}

function formatDriverName(name: string): string {
  const [last, first] = name.split(',')
  if (!last || !first?.trim()) return name.trim()
  const initial = first.trim()[0]!.toUpperCase()
  return `${last.trim()}, ${initial}.`
}

function toInputDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function titleCaseCity(value: string | null): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : ''))
    .join(' ')
}

interface EditState {
  confirmedDate: string
  confirmedLocation: string
  notes: string
  canada: boolean
  california: boolean
  rating: string
  equipment: string
  homeCity: string
  homeState: string
  // Tri-state: true = Yes, false = No, null = Maybe (the unset default).
  wgs: boolean | null
}

// WGS cycles Maybe -> Yes -> No -> Maybe on each click. Yes/No render as a
// ticked / empty checkbox; Maybe renders as a question mark (most compact).
const WGS_CYCLE: (boolean | null)[] = [null, true, false]

function wgsLabel(v: boolean | null): string {
  return v === true ? 'Yes' : v === false ? 'No' : 'Maybe'
}

function wgsGlyph(v: boolean | null): string {
  return v === true ? '☑' : v === false ? '☐' : '?'
}

type ReadyTier = 'confirmed' | 'actual' | 'estimated' | 'spread' | 'none'

interface ReadyTierMeta {
  icon: string | null
  label: string
}

const READY_TIER: Record<ReadyTier, ReadyTierMeta> = {
  confirmed: { icon: 'fa-calendar-check', label: 'Confirmed availability' },
  actual: { icon: 'fa-flag-checkered', label: 'Actual delivery date' },
  estimated: { icon: 'fa-truck-moving', label: 'Estimated delivery date' },
  spread: { icon: 'fa-question', label: 'Planned spread (least certain)' },
  none: { icon: null, label: '' },
}

interface ReadyGuess {
  kind: ReadyTier
  date: string | null
  state: string | null
  city: string | null
}

function getReadyGuess(driver: DriverPlanningRow): ReadyGuess {
  // Use the chronologically FINAL activity on the driver's latest trip — any
  // activity type — by reading the last `shipments` entry. Each shipment row
  // already represents its own final activity; the array is sorted ascending
  // by effective date so the trailing element wins. Falls back to the last
  // delivery (legacy RDEL list) when no shipments are present.
  const last =
    driver.shipments[driver.shipments.length - 1] ?? driver.deliveries[driver.deliveries.length - 1]
  const state = last?.state ?? null
  const city = last?.city ? titleCaseCity(last.city) : null

  if (last?.actualDate) {
    return { kind: 'actual', date: last.actualDate, state, city }
  }
  if (last?.estimatedDate) {
    return { kind: 'estimated', date: last.estimatedDate, state, city }
  }
  const spread = last?.plannedEnd ?? last?.plannedStart ?? null
  if (spread) {
    return { kind: 'spread', date: spread, state, city }
  }
  return { kind: 'none', date: null, state, city }
}

function ReadyTierIcon({ kind }: { kind: ReadyTier }) {
  const meta = READY_TIER[kind]
  if (!meta.icon) return null
  return (
    <HoverToolTip content={meta.label} direction="top">
      <i
        className={`fas ${meta.icon}`}
        data-testid="ready-tier-icon"
        data-icon={meta.icon}
        aria-label={meta.label}
      />
    </HoverToolTip>
  )
}

interface StateRefRow {
  geo_code?: string | null
  geo_name?: string | null
  zone?: string | null
}

interface ZoneRefRow {
  zone_code: string
  zone_description: string
}

function getDriverReadyState(driver: DriverPlanningRow): string | null {
  if (driver.confirmedAvailableLocation) {
    for (const part of driver.confirmedAvailableLocation.split(',')) {
      const t = part.trim()
      if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase()
    }
  }
  return getReadyGuess(driver).state
}

function getDriverZoneCode(driver: DriverPlanningRow, stateList: StateRefRow[]): string | null {
  const state = getDriverReadyState(driver)
  if (!state) return null
  const match = stateList.find((s) => (s.geo_code ?? '').toUpperCase() === state)
  return match?.zone ?? null
}

function getReadyDateKey(driver: DriverPlanningRow): string | null {
  return driver.confirmedAvailableDate ?? getReadyGuess(driver).date
}

type SortOrder = 'asc' | 'desc'

function nextSortOrder(current: SortOrder | null): SortOrder {
  return current === 'asc' ? 'desc' : 'asc'
}

/** ISO `YYYY-MM-DD` for an offset (in months) from today. */
function isoDateOffsetMonths(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

/** True when `dateStr` falls inside the [from, to] window (inclusive). Each
 *  bound may be empty — an empty bound means "open on that side". A null
 *  dateStr always fails the filter (driver has no calculated availability). */
function dateInRange(dateStr: string | null, from: string, to: string): boolean {
  if (!dateStr) return false
  if (from && dateStr < from) return false
  if (to && dateStr > to) return false
  return true
}

// Free-text / numeric / date / select edit fields. Canada & California are
// click-to-toggle booleans handled separately (no edit mode).
type EditField = 'emptyDate' | 'rating' | 'equipment' | 'notes' | 'homeCity' | 'homeState'

type StringEditKey = 'confirmedDate' | 'rating' | 'equipment' | 'notes' | 'homeCity' | 'homeState'

const FIELD_KEY: Record<EditField, StringEditKey> = {
  emptyDate: 'confirmedDate',
  rating: 'rating',
  equipment: 'equipment',
  notes: 'notes',
  homeCity: 'homeCity',
  homeState: 'homeState',
}

function parseRating(value: string): number | null {
  const r = Number.parseFloat(value)
  if (!Number.isFinite(r)) return null
  return Math.min(5, Math.max(0, r))
}

function DriverRow({ driver, stateList }: { driver: DriverPlanningRow; stateList: StateRefRow[] }) {
  const [editingField, setEditingField] = useState<EditField | null>(null)
  const [form, setForm] = useState<EditState>(() => ({
    confirmedDate: toInputDate(driver.confirmedAvailableDate),
    confirmedLocation: driver.confirmedAvailableLocation ?? '',
    notes: driver.confirmedNotes ?? '',
    canada: driver.canada,
    california: driver.california,
    rating: driver.rating == null ? '' : String(driver.rating),
    equipment: driver.equipment ?? '',
    homeCity: driver.homeCity ?? '',
    homeState: driver.homeState ?? '',
    wgs: driver.wgs,
  }))
  const [snapshot, setSnapshot] = useState('')
  const skipBlur = useRef(false)

  const mutation = useUpdateConfirmedAvailability()
  const guess = getReadyGuess(driver)
  const state = getDriverReadyState(driver)
  const zone = getDriverZoneCode(driver, stateList)
  const agency = driver.agentCode ?? AGENCY_PLACEHOLDER

  function startEdit(field: EditField) {
    setSnapshot(form[FIELD_KEY[field]])
    setEditingField(field)
  }

  // The upsert overwrites the whole row, so every save sends the full field set.
  function commitWith(f: EditState) {
    mutation.mutate(
      {
        driverId: driver.driverId,
        confirmedDate: f.confirmedDate || null,
        confirmedLocation: f.confirmedLocation || null,
        notes: f.notes || null,
        canada: f.canada,
        california: f.california,
        rating: parseRating(f.rating),
        equipment: f.equipment || null,
        homeCity: f.homeCity || null,
        homeState: f.homeState || null,
        wgs: f.wgs,
      },
      { onSuccess: () => setEditingField(null) },
    )
  }

  function commit() {
    commitWith(form)
  }

  function toggleBool(key: 'canada' | 'california') {
    const next = { ...form, [key]: !form[key] }
    setForm(next)
    commitWith(next)
  }

  function cycleWgs() {
    const idx = WGS_CYCLE.findIndex((v) => v === form.wgs)
    const next = { ...form, wgs: WGS_CYCLE[(idx + 1) % WGS_CYCLE.length]! }
    setForm(next)
    commitWith(next)
  }

  function handleBlur() {
    if (skipBlur.current) {
      skipBlur.current = false
      return
    }
    commit()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (editingField) setForm((f) => ({ ...f, [FIELD_KEY[editingField]]: snapshot }))
      skipBlur.current = true
      setEditingField(null)
    }
  }

  function fieldInput(
    field: EditField,
    extra: { type?: string; placeholder?: string; className?: string; step?: string },
  ) {
    return (
      <Input
        type={extra.type ?? 'text'}
        step={extra.step}
        autoFocus
        data-testid={`confirmed-${field}-input`}
        value={form[FIELD_KEY[field]]}
        placeholder={extra.placeholder}
        onChange={(e) => setForm((f) => ({ ...f, [FIELD_KEY[field]]: e.target.value }))}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={extra.className}
      />
    )
  }

  function equipmentSelect() {
    return (
      <select
        autoFocus
        data-testid="confirmed-equipment-select"
        value={form.equipment}
        onChange={(e) => {
          skipBlur.current = true
          const next = { ...form, equipment: e.target.value }
          setForm(next)
          commitWith(next)
        }}
        onBlur={handleBlur}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="">—</option>
        {EQUIPMENT_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }

  function boolCell(key: 'canada' | 'california', testid: string) {
    const on = form[key]
    return (
      <TableCell
        className={`cursor-pointer select-none ${on ? 'bg-yellow-200' : ''}`}
        data-testid={testid}
        onClick={() => toggleBool(key)}
      >
        {on ? 'Yes' : '-'}
      </TableCell>
    )
  }

  function wgsCell() {
    const label = wgsLabel(form.wgs)
    return (
      <TableCell
        className="cursor-pointer select-none text-center text-base"
        data-testid="driver-wgs"
        data-wgs={label.toLowerCase()}
        title={`WGS: ${label}`}
        aria-label={`WGS: ${label}`}
        onClick={cycleWgs}
      >
        {wgsGlyph(form.wgs)}
      </TableCell>
    )
  }

  return (
    <TableRow data-testid="driver-row" data-driver-id={driver.driverId} className={CARD_ROW_CLASS}>
      <TableCell
        className={`font-bold ${agencyBgClass(driver.agentCode)}`}
        data-testid="driver-name"
        data-agency={agency}
      >
        <HoverToolTip content={`Agency: ${agency}`} direction="top">
          <span>{formatDriverName(driver.driverName)}</span>
        </HoverToolTip>
      </TableCell>

      <TableCell data-testid="driver-code">{driver.driverId}</TableCell>

      <TableCell data-testid="driver-state">{state ? <b>{state}</b> : '-'}</TableCell>

      <TableCell data-testid="driver-zone">{zone ?? '-'}</TableCell>

      <TableCell>
        {editingField === 'emptyDate' ? (
          fieldInput('emptyDate', { type: 'date', className: 'w-40' })
        ) : (
          <span
            className="cursor-pointer hover:underline inline-flex items-center gap-1 font-semibold"
            data-testid="empty-date-cell"
            data-ready-tier={driver.confirmedAvailableDate ? 'confirmed' : guess.kind}
            onClick={() => startEdit('emptyDate')}
          >
            <ReadyTierIcon kind={driver.confirmedAvailableDate ? 'confirmed' : guess.kind} />
            {driver.confirmedAvailableDate
              ? formatMonthDay(driver.confirmedAvailableDate)
              : guess.date
                ? formatMonthDay(guess.date)
                : '-'}
          </span>
        )}
      </TableCell>

      {boolCell('canada', 'driver-canada')}
      {boolCell('california', 'driver-california')}
      {wgsCell()}

      <TableCell
        className={`cursor-pointer ${ratingClass(driver.rating)}`}
        data-testid="driver-rating"
        onClick={editingField === 'rating' ? undefined : () => startEdit('rating')}
      >
        {editingField === 'rating' ? (
          fieldInput('rating', {
            type: 'number',
            step: '0.1',
            placeholder: '0-5',
            className: 'w-20',
          })
        ) : (
          <span className="hover:underline">{formatRating(driver.rating)}</span>
        )}
      </TableCell>

      <TableCell
        className="cursor-pointer"
        data-testid="driver-equipment"
        onClick={editingField === 'equipment' ? undefined : () => startEdit('equipment')}
      >
        {editingField === 'equipment' ? (
          equipmentSelect()
        ) : (
          <span className="hover:underline">{driver.equipment || '-'}</span>
        )}
      </TableCell>

      <TableCell
        className="cursor-pointer"
        data-testid="notes-cell"
        onClick={editingField === 'notes' ? undefined : () => startEdit('notes')}
      >
        {editingField === 'notes' ? (
          fieldInput('notes', { placeholder: 'Notes', className: 'w-44' })
        ) : (
          <span className="hover:underline text-muted-foreground">
            {driver.confirmedNotes || '-'}
          </span>
        )}
      </TableCell>

      <TableCell
        className="cursor-pointer"
        data-testid="driver-home-city"
        onClick={editingField === 'homeCity' ? undefined : () => startEdit('homeCity')}
      >
        {editingField === 'homeCity' ? (
          fieldInput('homeCity', { placeholder: 'Home City', className: 'w-36' })
        ) : (
          <span className="hover:underline">{driver.homeCity || '-'}</span>
        )}
      </TableCell>

      <TableCell
        className="cursor-pointer"
        data-testid="driver-home-state"
        onClick={editingField === 'homeState' ? undefined : () => startEdit('homeState')}
      >
        {editingField === 'homeState' ? (
          fieldInput('homeState', { placeholder: 'Home State', className: 'w-24' })
        ) : (
          <span className="hover:underline">{driver.homeState || '-'}</span>
        )}
      </TableCell>
    </TableRow>
  )
}

interface ZoneOption {
  value: string
  label: string
}

export function AvailabilityViewB() {
  const { data: drivers, isLoading } = useQuery(driverPlanningQueryOptions)
  const stateList = useSelector(
    (state: RootState) => (state.common.stateList ?? []) as StateRefRow[],
  )
  const zoneList = useSelector((state: RootState) => (state.common.zoneList ?? []) as ZoneRefRow[])

  const [filter, setFilter] = useState('')
  const [selectedZones, setSelectedZones] = useState<ZoneOption[]>([])
  // Default sort: earliest calculated availability first.
  const [sortOrder, setSortOrder] = useState<SortOrder | null>('asc')
  // Default date range: today ±3 months, around the calculated availability.
  // A driver passes the filter when their calculated date sits inside the
  // window; drivers without a calculated date are excluded (clear both inputs
  // to show every driver).
  const [dateFrom, setDateFrom] = useState(() => isoDateOffsetMonths(-3))
  const [dateTo, setDateTo] = useState(() => isoDateOffsetMonths(3))

  const zoneOptions: ZoneOption[] = useMemo(
    () => zoneList.map((z) => ({ value: z.zone_code, label: z.zone_description })),
    [zoneList],
  )

  const visible = useMemo(() => {
    const all = drivers ?? []
    const selectedZoneCodes = selectedZones.map((z) => z.value)
    const rangeActive = dateFrom !== '' || dateTo !== ''
    const filtered = all.filter((d) => {
      if (filter && !d.driverName.toLowerCase().includes(filter.toLowerCase())) {
        return false
      }
      if (selectedZoneCodes.length > 0) {
        const z = getDriverZoneCode(d, stateList)
        if (!z || !selectedZoneCodes.includes(z)) return false
      }
      if (rangeActive && !dateInRange(getReadyDateKey(d), dateFrom, dateTo)) {
        return false
      }
      return true
    })
    if (!sortOrder) return filtered
    return filtered.slice().sort((a, b) => {
      const aKey = getReadyDateKey(a)
      const bKey = getReadyDateKey(b)
      if (aKey == null && bKey == null) return 0
      if (aKey == null) return 1
      if (bKey == null) return -1
      const diff = +new Date(aKey) - +new Date(bKey)
      return sortOrder === 'asc' ? diff : -diff
    })
  }, [drivers, filter, selectedZones, sortOrder, stateList, dateFrom, dateTo])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {(drivers ?? []).length === 0 ? (
        <EmptyState
          title="No drivers found"
          description="Drivers will appear here once available in the system."
        />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Input
              placeholder="Filter by driver name..."
              data-testid="driver-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="max-w-sm"
            />
            <div className="min-w-[16rem]" data-testid="driver-zone-filter">
              <Select
                isMulti
                placeholder="Zone"
                options={zoneOptions}
                value={selectedZones}
                onChange={(value: unknown) =>
                  setSelectedZones((value as ZoneOption[] | null) ?? [])
                }
              />
            </div>
            <div
              className={`flex items-center gap-2 text-sm ${CARD_TEXT_CLASS}`}
              data-testid="ready-date-range-filter"
            >
              <span>From</span>
              <Input
                type="date"
                data-testid="ready-date-from"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-40"
              />
              <span>To</span>
              <Input
                type="date"
                data-testid="ready-date-to"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-40"
              />
            </div>
          </div>
          <div className="rounded-md bg-transparent">
            <Table data-testid="driver-table">
              <TableHeader>
                <TableRow>
                  <TableHead className={CARD_TEXT_CLASS}>Driver Name</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Driver Code</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>State</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Zone</TableHead>
                  <TableHead
                    className={`${CARD_TEXT_CLASS} cursor-pointer select-none`}
                    data-testid="empty-date-header"
                    onClick={() => setSortOrder((o) => nextSortOrder(o))}
                  >
                    <span className="inline-flex items-center gap-1">
                      Empty Date
                      {sortOrder && (
                        <i
                          className="fas fa-caret-up"
                          data-testid="empty-date-sort-icon"
                          data-sort-order={sortOrder}
                          style={sortOrder === 'desc' ? { transform: 'rotate(180deg)' } : undefined}
                        />
                      )}
                    </span>
                  </TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Canada?</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>California?</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>WGS</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Rating</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Equipment</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Notes</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Home City</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Home State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={13}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      No matching drivers.
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map((driver) => (
                    <DriverRow key={driver.driverId} driver={driver} stateList={stateList} />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}
