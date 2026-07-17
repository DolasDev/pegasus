// ---------------------------------------------------------------------------
// Availability view variant A.
//
// One of three parallel copies (A/B/C) wired into routes/driver-planning.index.tsx
// behind a "Change View" tab toggle. Each variant starts as a verbatim copy of
// the original Availability page so the three can evolve independently. Edit
// freely — there is no shared base; divergence between A/B/C is the point.
// ---------------------------------------------------------------------------
import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
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
  type Delivery,
  type DriverPlanningRow,
} from '@/api/queries/driver-planning'
import { formatDateShort } from '@/features/driver-planning/utils/format-date'
import { smsDriver } from '@/features/driver-planning/utils/sms-driver'
import { HoverToolTip } from '@/features/driver-planning/containers/ToolTips'
import { Select } from '@/features/driver-planning/components/Select'
import type { RootState } from '@/features/driver-planning/redux/store'

const PLACEHOLDER_PHONE = '+12345678910'

const CARD_TEXT_CLASS = 'text-[#0c145c]'
const CARD_ROW_CLASS = `bg-white/30 shadow-sm hover:bg-[#f5f5f5] ${CARD_TEXT_CLASS} font-light`

const EQUIPMENT_OPTIONS = ['Tractor Trailer', 'Straight Truck']

const AGENCY_PLACEHOLDER = '1111'

// Driver-name cell background keyed by agency (agent code). Ported from View B.
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

// WGS cycles Maybe -> Yes -> No -> Maybe on each click. Yes/No render as a
// ticked / empty checkbox; Maybe renders as a question mark (most compact).
const WGS_CYCLE: (boolean | null)[] = [null, true, false]

function wgsLabel(v: boolean | null): string {
  return v === true ? 'Yes' : v === false ? 'No' : 'Maybe'
}

function wgsGlyph(v: boolean | null): string {
  return v === true ? '☑' : v === false ? '☐' : '?'
}

// Color-code the WGS glyph: green + bold for Yes, muted red + bold for No, and
// leave Maybe (the unset default) visually untouched.
function wgsColorClass(v: boolean | null): string {
  if (v === true) return 'text-green-600 font-bold'
  if (v === false) return 'text-red-400 font-bold'
  return ''
}

function ratingClass(rating: number | null): string {
  return rating != null && rating < 4.5 ? 'bg-red-200 text-red-700' : ''
}

function formatRating(rating: number | null): string {
  return rating == null ? '-' : rating.toFixed(1)
}

function parseRating(value: string): number | null {
  const r = Number.parseFloat(value)
  if (!Number.isFinite(r)) return null
  return Math.min(5, Math.max(0, r))
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

/** Pull `STATE` and `City` out of the canonical "STATE, City" storage format.
 *  Strings without a 2-letter leading code put everything into `city`. */
function parseLocation(value: string | null): { state: string; city: string } {
  if (!value) return { state: '', city: '' }
  const parts = value.split(',').map((p) => p.trim())
  const head = parts[0] ?? ''
  if (/^[A-Za-z]{2}$/.test(head)) {
    return { state: head.toUpperCase(), city: parts.slice(1).join(', ') }
  }
  return { state: '', city: value }
}

function joinLocation(state: string, city: string): string {
  const s = state.trim().toUpperCase()
  const c = city.trim()
  if (s && c) return `${s}, ${c}`
  return s || c
}

function toInputDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

interface EditState {
  confirmedDate: string
  confirmedState: string
  confirmedCity: string
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

interface ConfidenceTier {
  icon: string | null
  colorClass: string
  label: string
}

function getConfidenceTier(d: Delivery): ConfidenceTier {
  // Per-tier confidence hue, ported from View C: deepening emerald as certainty
  // rises. View A additionally has a spread tier (View C has none) — muted, as
  // the least-certain signal.
  if (d.actualDate) {
    return { icon: 'fa-truck-moving', colorClass: 'text-emerald-700', label: 'Verified complete' }
  }
  if (d.isConfirmed) {
    return {
      icon: 'fa-flag-checkered',
      colorClass: 'text-emerald-600',
      label: 'Confirmed with driver',
    }
  }
  if (d.isCommitted) {
    return { icon: 'fa-check', colorClass: 'text-emerald-500', label: 'Driver committed' }
  }
  // Spread fallback — the date shown comes from planned_start only (no
  // estimated / actual). Mirrors the Ready Date "spread" tier.
  if (!d.estimatedDate && d.plannedStart) {
    return {
      icon: 'fa-question',
      colorClass: 'text-muted-foreground',
      label: 'Planned spread (least certain)',
    }
  }
  return { icon: null, colorClass: '', label: '' }
}

function titleCaseCity(value: string | null): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : ''))
    .join(' ')
}

function getDeliveryEffectiveDate(d: Delivery): string | null {
  return d.actualDate ?? d.estimatedDate ?? d.plannedStart ?? null
}

function DeliveryLine({
  delivery,
  testId = 'delivery-line',
}: {
  delivery: Delivery
  testId?: string
}) {
  const tier = getConfidenceTier(delivery)
  const effective = getDeliveryEffectiveDate(delivery)
  const effStr = effective ? formatDateShort(effective) : ''
  const city = titleCaseCity(delivery.city)

  // Column order: date | state | icon. The city is no longer its own column —
  // it surfaces as a tooltip on hover over the state. No bold inside shipment
  // rows — every cell inherits the row's regular weight.
  return (
    <tr
      className="whitespace-nowrap align-top"
      data-testid={testId}
      data-activity-id={delivery.activityId}
    >
      <td className="pr-1.5 text-right tabular-nums">
        {effective ? (
          <span data-testid="delivery-effective">{effStr}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
      <td className="px-1.5" data-testid="delivery-state" data-city={city}>
        {city ? (
          <HoverToolTip content={city} direction="top">
            <span>{delivery.state ?? ''}</span>
          </HoverToolTip>
        ) : (
          (delivery.state ?? '')
        )}
      </td>
      <td className="pl-1.5">
        {tier.icon && (
          <HoverToolTip content={tier.label} direction="top">
            <i
              className={`fas ${tier.icon} ${tier.colorClass}`}
              data-testid="delivery-icon"
              data-icon={tier.icon}
              aria-label={tier.label}
            />
          </HoverToolTip>
        )}
      </td>
    </tr>
  )
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

// Ready Date / Ready State / Ready City are linked: editing any of the three
// opens all three at once and the mutation only fires when every one is
// filled in. Notes still edits independently, as do the roster free-text /
// numeric / select fields ported from Variant B. Canada/California/WGS are
// click-to-toggle (no edit mode) and commit immediately.
type LinkedFocus = 'date' | 'state' | 'city'
type RosterField = 'rating' | 'equipment' | 'homeCity' | 'homeState'
type EditMode =
  | { kind: 'linked'; focus: LinkedFocus }
  | { kind: 'notes' }
  | { kind: 'field'; field: RosterField }
  | null

function DriverRow({ driver }: { driver: DriverPlanningRow }) {
  const [editMode, setEditMode] = useState<EditMode>(null)
  const initialForm = (): EditState => {
    const { state, city } = parseLocation(driver.confirmedAvailableLocation)
    return {
      confirmedDate: toInputDate(driver.confirmedAvailableDate),
      confirmedState: state,
      confirmedCity: city,
      notes: driver.confirmedNotes ?? '',
      canada: driver.canada,
      california: driver.california,
      rating: driver.rating == null ? '' : String(driver.rating),
      equipment: driver.equipment ?? '',
      homeCity: driver.homeCity ?? '',
      homeState: driver.homeState ?? '',
      wgs: driver.wgs,
    }
  }
  const [form, setForm] = useState<EditState>(initialForm)
  const [snapshot, setSnapshot] = useState<EditState>(form)
  const skipBlur = useRef(false)

  const mutation = useUpdateConfirmedAvailability()
  const guess = getReadyGuess(driver)
  const agency = driver.agentCode ?? AGENCY_PLACEHOLDER

  // The PATCH upsert overwrites the whole row, so EVERY save must send the full
  // field set — including the roster fields — or omitted columns get nulled out.
  function commitWith(f: EditState) {
    mutation.mutate(
      {
        driverId: driver.driverId,
        confirmedDate: f.confirmedDate || null,
        confirmedLocation: joinLocation(f.confirmedState, f.confirmedCity) || null,
        notes: f.notes || null,
        canada: f.canada,
        california: f.california,
        rating: parseRating(f.rating),
        equipment: f.equipment || null,
        homeCity: f.homeCity || null,
        homeState: f.homeState || null,
        wgs: f.wgs,
      },
      { onSuccess: () => setEditMode(null) },
    )
  }

  function startLinkedEdit(focus: LinkedFocus) {
    setSnapshot(form)
    setEditMode({ kind: 'linked', focus })
  }

  function startNotesEdit() {
    setSnapshot(form)
    setEditMode({ kind: 'notes' })
  }

  function startFieldEdit(field: RosterField) {
    setSnapshot(form)
    setEditMode({ kind: 'field', field })
  }

  function commitLinked() {
    const date = form.confirmedDate.trim()
    const state = form.confirmedState.trim()
    const city = form.confirmedCity.trim()
    // Partial commits are a no-op — the user must populate all three before
    // anything saves. The inputs stay rendered so they can finish.
    if (!date || !state || !city) return
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
    if (editMode?.kind === 'linked') commitLinked()
    else if (editMode?.kind === 'notes' || editMode?.kind === 'field') commitWith(form)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setForm(snapshot)
      skipBlur.current = true
      setEditMode(null)
    }
  }

  function linkedInput(
    field: LinkedFocus,
    key: 'confirmedDate' | 'confirmedState' | 'confirmedCity',
    extra: { type?: string; placeholder?: string; className?: string; maxLength?: number },
  ) {
    return (
      <Input
        type={extra.type ?? 'text'}
        autoFocus={editMode?.kind === 'linked' && editMode.focus === field}
        data-testid={`confirmed-${field}-input`}
        value={form[key]}
        placeholder={extra.placeholder}
        maxLength={extra.maxLength}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={extra.className}
      />
    )
  }

  function rosterInput(
    field: 'rating' | 'homeCity' | 'homeState',
    extra: { type?: string; placeholder?: string; className?: string; step?: string },
  ) {
    return (
      <Input
        type={extra.type ?? 'text'}
        step={extra.step}
        autoFocus
        data-testid={`confirmed-${field}-input`}
        value={form[field]}
        placeholder={extra.placeholder}
        onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
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
        className={`cursor-pointer select-none text-center text-base ${wgsColorClass(form.wgs)}`}
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
        className={agencyBgClass(driver.agentCode)}
        data-testid="driver-name"
        data-agency={agency}
      >
        <span className="inline-flex items-center gap-2">
          <a
            href={`tel:${PLACEHOLDER_PHONE}`}
            aria-label="Call driver"
            data-testid="driver-call"
            className={`${CARD_TEXT_CLASS} hover:opacity-80`}
            onClick={(e) => e.stopPropagation()}
          >
            <i className="fas fa-phone" />
          </a>
          <a
            href="#"
            aria-label="Text driver"
            data-testid="driver-sms"
            data-driver-code={driver.agentCode ?? ''}
            className={`${CARD_TEXT_CLASS} hover:opacity-80`}
            onClick={(e) => {
              // Hand off to the desktop app via the pegasus-desktop:// URI —
              // same pattern as jump-to-order. Util handles config gating,
              // validation, and the optimistic notify UX.
              e.preventDefault()
              e.stopPropagation()
              smsDriver({ driver_code: driver.agentCode })
            }}
          >
            <i className="fas fa-comment-sms" />
          </a>
          <HoverToolTip content={`Agency: ${agency}`} direction="top">
            <span>{formatDriverName(driver.driverName)}</span>
          </HoverToolTip>
        </span>
      </TableCell>

      <TableCell>
        {editMode?.kind === 'linked' ? (
          linkedInput('date', 'confirmedDate', { type: 'date', className: 'w-40' })
        ) : driver.confirmedAvailableDate ? (
          <span
            className="cursor-pointer hover:underline inline-flex items-center gap-1 font-bold"
            data-testid="ready-date-cell"
            data-ready-tier="confirmed"
            onClick={() => startLinkedEdit('date')}
          >
            <ReadyTierIcon kind="confirmed" />
            {formatMonthDay(driver.confirmedAvailableDate)}
          </span>
        ) : (
          <span
            className="cursor-pointer hover:underline inline-flex items-center gap-1 font-bold"
            data-testid="ready-date-cell"
            data-ready-tier={guess.kind}
            onClick={() => startLinkedEdit('date')}
          >
            <ReadyTierIcon kind={guess.kind} />
            {guess.date ? formatMonthDay(guess.date) : '-'}
          </span>
        )}
      </TableCell>

      <TableCell>
        {editMode?.kind === 'linked' ? (
          linkedInput('state', 'confirmedState', {
            placeholder: 'TX',
            className: 'w-16',
            maxLength: 2,
          })
        ) : (
          <span
            className="cursor-pointer hover:underline font-bold"
            data-testid="ready-state-cell"
            onClick={() => startLinkedEdit('state')}
          >
            {(() => {
              const parsed = parseLocation(driver.confirmedAvailableLocation)
              const state = parsed.state || guess.state || ''
              return state ? <b>{state}</b> : '-'
            })()}
          </span>
        )}
      </TableCell>

      <TableCell>
        {editMode?.kind === 'linked' ? (
          linkedInput('city', 'confirmedCity', { placeholder: 'City', className: 'w-36' })
        ) : (
          <span
            className="cursor-pointer hover:underline"
            data-testid="ready-city-cell"
            onClick={() => startLinkedEdit('city')}
          >
            {(() => {
              const parsed = parseLocation(driver.confirmedAvailableLocation)
              const city = parsed.city || guess.city || ''
              return city || '-'
            })()}
          </span>
        )}
      </TableCell>

      <TableCell data-testid="driver-deliveries">
        {driver.shipments.length === 0 ? (
          <span className="text-muted-foreground">-</span>
        ) : driver.currentTripId ? (
          // The whole deliveries table is a click-through to the driver's
          // current trip — there's no Current Trip column any more.
          <Link
            to="/driver-planning/trips/$tripId"
            params={{ tripId: String(driver.currentTripId) }}
            data-testid="deliveries-trip-link"
            className="cursor-pointer hover:underline"
          >
            <table className="border-separate border-spacing-x-1 border-spacing-y-0.5 text-xs">
              <tbody>
                {driver.shipments.map((s) => (
                  <DeliveryLine key={s.orderNum} delivery={s} testId="shipment-line" />
                ))}
              </tbody>
            </table>
          </Link>
        ) : (
          <table className="border-separate border-spacing-x-1 border-spacing-y-0.5 text-xs">
            <tbody>
              {driver.shipments.map((s) => (
                <DeliveryLine key={s.orderNum} delivery={s} testId="shipment-line" />
              ))}
            </tbody>
          </table>
        )}
      </TableCell>

      <TableCell>
        {editMode?.kind === 'notes' ? (
          <Input
            autoFocus
            data-testid="confirmed-notes-input"
            value={form.notes}
            placeholder="Notes"
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="w-44"
          />
        ) : (
          <span
            className="cursor-pointer hover:underline text-muted-foreground"
            data-testid="notes-cell"
            onClick={() => startNotesEdit()}
          >
            {driver.confirmedNotes || '-'}
          </span>
        )}
      </TableCell>

      {boolCell('canada', 'driver-canada')}
      {boolCell('california', 'driver-california')}
      {wgsCell()}

      <TableCell
        className={`cursor-pointer ${ratingClass(driver.rating)}`}
        data-testid="driver-rating"
        onClick={
          editMode?.kind === 'field' && editMode.field === 'rating'
            ? undefined
            : () => startFieldEdit('rating')
        }
      >
        {editMode?.kind === 'field' && editMode.field === 'rating' ? (
          rosterInput('rating', {
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
        onClick={
          editMode?.kind === 'field' && editMode.field === 'equipment'
            ? undefined
            : () => startFieldEdit('equipment')
        }
      >
        {editMode?.kind === 'field' && editMode.field === 'equipment' ? (
          equipmentSelect()
        ) : (
          <span className="hover:underline">{driver.equipment || '-'}</span>
        )}
      </TableCell>

      <TableCell
        className="cursor-pointer"
        data-testid="driver-home-state"
        onClick={
          editMode?.kind === 'field' && editMode.field === 'homeState'
            ? undefined
            : () => startFieldEdit('homeState')
        }
      >
        {editMode?.kind === 'field' && editMode.field === 'homeState' ? (
          rosterInput('homeState', { placeholder: 'Home State', className: 'w-24' })
        ) : (
          <span className="hover:underline">{driver.homeState || '-'}</span>
        )}
      </TableCell>

      <TableCell
        className="cursor-pointer"
        data-testid="driver-home-city"
        onClick={
          editMode?.kind === 'field' && editMode.field === 'homeCity'
            ? undefined
            : () => startFieldEdit('homeCity')
        }
      >
        {editMode?.kind === 'field' && editMode.field === 'homeCity' ? (
          rosterInput('homeCity', { placeholder: 'Home City', className: 'w-36' })
        ) : (
          <span className="hover:underline">{driver.homeCity || '-'}</span>
        )}
      </TableCell>
    </TableRow>
  )
}

interface ZoneOption {
  value: string
  label: string
}

export function AvailabilityViewA() {
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
                  <TableHead className={CARD_TEXT_CLASS}>Driver</TableHead>
                  <TableHead
                    className={`${CARD_TEXT_CLASS} cursor-pointer select-none`}
                    data-testid="ready-date-header"
                    onClick={() => setSortOrder((o) => nextSortOrder(o))}
                  >
                    <span className="inline-flex items-center gap-1">
                      Ready Date
                      {sortOrder && (
                        <i
                          className="fas fa-caret-up"
                          data-testid="ready-date-sort-icon"
                          data-sort-order={sortOrder}
                          style={sortOrder === 'desc' ? { transform: 'rotate(180deg)' } : undefined}
                        />
                      )}
                    </span>
                  </TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Ready State</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Ready City</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Deliveries</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Notes</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Canada?</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>California?</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>WGS</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Rating</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Equipment</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Home State</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Home City</TableHead>
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
                  visible.map((driver) => <DriverRow key={driver.driverId} driver={driver} />)
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}
