import { useMemo, useRef, useState, type ReactNode } from 'react'
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
import { Badge } from '@/components/ui/badge'
import {
  driverPlanningQueryOptions,
  useUpdateConfirmedAvailability,
  type Delivery,
  type DriverPlanningRow,
} from '@/api/queries/driver-planning'
import { formatDateShort } from '@/features/driver-planning/utils/format-date'
import { HoverToolTip } from '@/features/driver-planning/containers/ToolTips'
import { Select } from '@/features/driver-planning/components/Select'
import type { RootState } from '@/features/driver-planning/redux/store'

// Driver phone numbers are not yet exposed by the driver-planning payload, so
// the phone/SMS quick-actions fall back to a placeholder. Replace with
// `driver.phone` once the API surfaces it (see plan follow-up).
const PLACEHOLDER_PHONE = '+12345678910'

// Card aesthetic taken from features/driver-planning/components/Card/Card.module.css
// — the same shared "shipment card" wrapper used across Operations. Inlined as a
// Tailwind arbitrary-value class so this route doesn't depend on the
// `.driver-planning-root` CSS variable being in scope (the layout DOES wrap us
// in that root, but we read better without the indirection).
const CARD_TEXT_CLASS = 'text-[#0c145c]' // --blue-700
const CARD_ROW_CLASS = `bg-white/30 shadow-sm hover:bg-[#f5f5f5] ${CARD_TEXT_CLASS} font-light`

// Compact month/day for the Ready Date column (US date order, matches the
// rest of Operations). UTC mirrors `formatDateShort` so dates don't slip a day
// across the local timezone boundary.
function formatMonthDay(dateStr: string | null): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${mm}/${dd}`
}

// Driver names arrive from the legacy view as "Last, First"; render them as
// "Last, F.". Anything without a comma + given name passes through untouched.
function formatDriverName(name: string): string {
  const [last, first] = name.split(',')
  if (!last || !first?.trim()) return name.trim()
  const initial = first.trim()[0]!.toUpperCase()
  return `${last.trim()}, ${initial}.`
}

// Render a free-form Ready Location with only the leading state token bolded.
// The input is a hand-entered "State, City" string (placeholder matches), but
// users sometimes flip the order or omit the state entirely. We only bold a
// leading 2-letter token; anything else is left plain.
function renderConfirmedLocation(value: string): ReactNode {
  const parts = value.split(',').map((p) => p.trim())
  const head = parts[0] ?? ''
  if (/^[A-Za-z]{2}$/.test(head)) {
    const rest = parts.slice(1).join(', ')
    return (
      <>
        <b>{head.toUpperCase()}</b>
        {rest ? `, ${rest}` : ''}
      </>
    )
  }
  return value
}

function toInputDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

interface EditState {
  confirmedDate: string
  confirmedLocation: string
  notes: string
}

// ---------------------------------------------------------------------------
// Per-delivery row on the driver's availability card.
//
// Rendered as a borderless table (one per driver) so the columns line up across
// every delivery row. Column order: STATE | effective date | confidence icon |
// City | phone/SMS quick-actions. The effective date is a single column
// (priority actual → estimated → planned-start) bolded + color-coded to the
// confidence tier; the matching Font Awesome glyph sits immediately to its
// right (truck = actual, flag = confirmed, check = committed). Phone + SMS
// anchors are always present in the trailing column — dispatchers reach for
// the driver from the same spot regardless of whether the row has an effective
// date.
// ---------------------------------------------------------------------------

interface ConfidenceTier {
  /** Font Awesome glyph after `fa-` (empty string when no confidence). */
  icon: string | null
  /** Tailwind text-color class for the bolded effective date. */
  colorClass: string
  /** Hover tooltip label for the icon. */
  label: string
}

function getConfidenceTier(d: Delivery): ConfidenceTier {
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

/** Single date shown per delivery row. Priority: actual → estimated → spread-start. */
function getDeliveryEffectiveDate(d: Delivery): string | null {
  return d.actualDate ?? d.estimatedDate ?? d.plannedStart ?? null
}

function DeliveryLine({ delivery }: { delivery: Delivery }) {
  const tier = getConfidenceTier(delivery)
  const effective = getDeliveryEffectiveDate(delivery)
  const effStr = effective ? formatDateShort(effective) : ''
  // Dates stay neutral; the confidence tier's color lives on the icon only so
  // dispatchers don't have to parse two color signals per row.
  const boldClass = 'font-semibold'

  return (
    <tr
      className="whitespace-nowrap align-top"
      data-testid="delivery-line"
      data-activity-id={delivery.activityId}
    >
      <td className="pr-1.5">{delivery.state && <b>{delivery.state}</b>}</td>
      <td className="px-1.5 text-right tabular-nums">
        {effective ? (
          <span className={boldClass} data-testid="delivery-effective">
            {effStr}
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
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
      <td className="pl-1.5">{titleCaseCity(delivery.city)}</td>
      <td className="pl-1.5">
        <span className="inline-flex items-center gap-1.5">
          <a
            href={`tel:${PLACEHOLDER_PHONE}`}
            aria-label="Call driver"
            data-testid="delivery-call"
            className="text-muted-foreground hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <i className="fas fa-phone" />
          </a>
          <a
            href={`sms:${PLACEHOLDER_PHONE}`}
            aria-label="Text driver"
            data-testid="delivery-sms"
            className="text-muted-foreground hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <i className="fas fa-comment-sms" />
          </a>
        </span>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Ready date/location best-guess.
//
// When a driver has no confirmed availability we estimate when/where they free
// up from their LAST delivery (deliveries arrive sorted by effective date).
// The tier drives a source icon (see READY_ICON) rendered next to the bolded
// date/location: actual = checkered flag, estimated = truck, spread = question
// mark (least certain).
// ---------------------------------------------------------------------------

type ReadyTier = 'confirmed' | 'actual' | 'estimated' | 'spread' | 'none'

interface ReadyTierMeta {
  /** Font Awesome glyph after `fa-` (null when there is no source icon). */
  icon: string | null
  /** Hover tooltip label describing where the date/location came from. */
  label: string
}

// Maps a ready-date/location source to its icon. The truck and checkered-flag
// glyphs mirror the DeliveryLine / ActivityGantt convention for consistency.
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
  const last = driver.deliveries[driver.deliveries.length - 1]
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

// Source icon shown before the bolded Ready Date / Ready Location. Renders
// nothing for the 'none' tier.
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

// ---------------------------------------------------------------------------
// Zone & sort helpers (used by DriverPlanningPage)
// ---------------------------------------------------------------------------

interface StateRefRow {
  geo_code?: string | null
  geo_name?: string | null
  zone?: string | null
}

interface ZoneRefRow {
  zone_code: string
  zone_description: string
}

/** Two-letter state extracted from confirmedAvailableLocation when present
 *  (formats like "TX", "TX, Dallas" or "Dallas, TX" all surface a two-letter
 *  token after splitting on commas). Falls back to the best-guess state from
 *  the last delivery. */
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

/** Effective ready date used for both display and sort. */
function getReadyDateKey(driver: DriverPlanningRow): string | null {
  return driver.confirmedAvailableDate ?? getReadyGuess(driver).date
}

type SortOrder = 'asc' | 'desc'

/** Mirrors getSortByValue from containers/Shipments/index.tsx. */
function nextSortOrder(current: SortOrder | null): SortOrder {
  return current === 'asc' ? 'desc' : 'asc'
}

type EditField = 'date' | 'location' | 'notes'

const FIELD_KEY: Record<EditField, keyof EditState> = {
  date: 'confirmedDate',
  location: 'confirmedLocation',
  notes: 'notes',
}

function DriverRow({ driver }: { driver: DriverPlanningRow }) {
  // The form is the working copy across all three click-to-edit fields; it is
  // seeded once and never blindly reset, so editing one field never discards a
  // pending edit on another. Display (non-editing) always reads server state
  // off `driver`, so it reflects the latest persisted values.
  const [editingField, setEditingField] = useState<EditField | null>(null)
  const [form, setForm] = useState<EditState>(() => ({
    confirmedDate: toInputDate(driver.confirmedAvailableDate),
    confirmedLocation: driver.confirmedAvailableLocation ?? '',
    notes: driver.confirmedNotes ?? '',
  }))
  // Value of the field at the start of the current edit session, for Escape.
  const [snapshot, setSnapshot] = useState('')
  // Set just before an Escape-driven unmount so the resulting blur skips commit.
  const skipBlur = useRef(false)

  const mutation = useUpdateConfirmedAvailability()
  const guess = getReadyGuess(driver)

  function startEdit(field: EditField) {
    setSnapshot(form[FIELD_KEY[field]])
    setEditingField(field)
  }

  function commit() {
    mutation.mutate(
      {
        driverId: driver.driverId,
        confirmedDate: form.confirmedDate || null,
        confirmedLocation: form.confirmedLocation || null,
        notes: form.notes || null,
      },
      { onSuccess: () => setEditingField(null) },
    )
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
      e.currentTarget.blur() // → handleBlur → commit
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (editingField) setForm((f) => ({ ...f, [FIELD_KEY[editingField]]: snapshot }))
      skipBlur.current = true
      setEditingField(null)
    }
  }

  function fieldInput(
    field: EditField,
    extra: { type?: string; placeholder?: string; className?: string },
  ) {
    return (
      <Input
        type={extra.type ?? 'text'}
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

  return (
    <TableRow data-testid="driver-row" data-driver-id={driver.driverId} className={CARD_ROW_CLASS}>
      <TableCell className="font-bold" data-testid="driver-name">
        {formatDriverName(driver.driverName)}
      </TableCell>

      {/* Ready Date */}
      <TableCell>
        {editingField === 'date' ? (
          fieldInput('date', { type: 'date', className: 'w-40' })
        ) : driver.confirmedAvailableDate ? (
          <span
            className="cursor-pointer hover:underline inline-flex items-center gap-1 font-semibold"
            data-testid="ready-date-cell"
            data-ready-tier="confirmed"
            onClick={() => startEdit('date')}
          >
            <ReadyTierIcon kind="confirmed" />
            {formatMonthDay(driver.confirmedAvailableDate)}
          </span>
        ) : (
          <span
            className="cursor-pointer hover:underline inline-flex items-center gap-1 font-semibold"
            data-testid="ready-date-cell"
            data-ready-tier={guess.kind}
            onClick={() => startEdit('date')}
          >
            <ReadyTierIcon kind={guess.kind} />
            {guess.date ? formatMonthDay(guess.date) : '-'}
          </span>
        )}
      </TableCell>

      {/* Ready Location */}
      <TableCell>
        {editingField === 'location' ? (
          fieldInput('location', { placeholder: 'State, City', className: 'w-44' })
        ) : driver.confirmedAvailableLocation ? (
          // Only the state token is bolded. If the leading comma-separated
          // token is a 2-letter state code (matches the "State, City" hint),
          // wrap it in <b>; otherwise the freeform string renders plain.
          <span
            className="cursor-pointer hover:underline"
            data-testid="ready-location-cell"
            onClick={() => startEdit('location')}
          >
            {renderConfirmedLocation(driver.confirmedAvailableLocation)}
          </span>
        ) : (
          <span
            className="cursor-pointer hover:underline inline-flex items-center gap-1"
            data-testid="ready-location-cell"
            onClick={() => startEdit('location')}
          >
            <ReadyTierIcon kind={guess.kind} />
            {guess.state || guess.city ? (
              <span>
                {guess.state && <b>{guess.state}</b>}
                {guess.state && guess.city ? ', ' : ''}
                {guess.city}
              </span>
            ) : (
              '-'
            )}
          </span>
        )}
      </TableCell>

      {/* Deliveries */}
      <TableCell data-testid="driver-deliveries">
        {driver.deliveries.length === 0 ? (
          <span className="text-muted-foreground">-</span>
        ) : (
          <table className="border-separate border-spacing-x-1 border-spacing-y-0.5 text-xs">
            <tbody>
              {driver.deliveries.map((d) => (
                <DeliveryLine key={d.activityId} delivery={d} />
              ))}
            </tbody>
          </table>
        )}
      </TableCell>

      {/* Notes */}
      <TableCell>
        {editingField === 'notes' ? (
          fieldInput('notes', { placeholder: 'Notes', className: 'w-44' })
        ) : (
          <span
            className="cursor-pointer hover:underline text-muted-foreground"
            data-testid="notes-cell"
            onClick={() => startEdit('notes')}
          >
            {driver.confirmedNotes || '-'}
          </span>
        )}
      </TableCell>

      {/* Current Trip — navigates to the trip screen. Badge font-normal so
          the chip text isn't bolded (shadcn Badge defaults to font-semibold). */}
      <TableCell data-testid="driver-current-trip">
        {driver.currentTripId ? (
          <Link
            to="/driver-planning/trips/$tripId"
            params={{ tripId: String(driver.currentTripId) }}
            data-testid="current-trip-link"
          >
            <Badge variant="secondary" className="cursor-pointer hover:underline font-normal">
              {driver.currentTripTitle ?? 'View trip'}
            </Badge>
          </Link>
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </TableCell>
    </TableRow>
  )
}

interface ZoneOption {
  value: string
  label: string
}

export function DriverPlanningPage() {
  const { data: drivers, isLoading } = useQuery(driverPlanningQueryOptions)
  const stateList = useSelector(
    (state: RootState) => (state.common.stateList ?? []) as StateRefRow[],
  )
  const zoneList = useSelector((state: RootState) => (state.common.zoneList ?? []) as ZoneRefRow[])

  const [filter, setFilter] = useState('')
  const [selectedZones, setSelectedZones] = useState<ZoneOption[]>([])
  const [sortOrder, setSortOrder] = useState<SortOrder | null>(null)

  const zoneOptions: ZoneOption[] = useMemo(
    () => zoneList.map((z) => ({ value: z.zone_code, label: z.zone_description })),
    [zoneList],
  )

  const visible = useMemo(() => {
    const all = drivers ?? []
    const selectedZoneCodes = selectedZones.map((z) => z.value)
    const filtered = all.filter((d) => {
      if (filter && !d.driverName.toLowerCase().includes(filter.toLowerCase())) {
        return false
      }
      if (selectedZoneCodes.length > 0) {
        const z = getDriverZoneCode(d, stateList)
        if (!z || !selectedZoneCodes.includes(z)) return false
      }
      return true
    })
    if (!sortOrder) return filtered
    return filtered.slice().sort((a, b) => {
      const aKey = getReadyDateKey(a)
      const bKey = getReadyDateKey(b)
      if (aKey == null && bKey == null) return 0
      // Nulls sort LAST in both directions — drivers with no ready date stay
      // at the bottom regardless of sort direction (predictable for dispatchers).
      if (aKey == null) return 1
      if (bKey == null) return -1
      const diff = +new Date(aKey) - +new Date(bKey)
      return sortOrder === 'asc' ? diff : -diff
    })
  }, [drivers, filter, selectedZones, sortOrder, stateList])

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
                  <TableHead className={CARD_TEXT_CLASS}>Ready Location</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Deliveries</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Notes</TableHead>
                  <TableHead className={CARD_TEXT_CLASS}>Current Trip</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
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
