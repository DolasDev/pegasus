import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check, X } from 'lucide-react'
import {
  driverPlanningQueryOptions,
  useUpdateConfirmedAvailability,
  type Delivery,
  type DriverPlanningRow,
} from '@/api/queries/driver-planning'
import { formatDateShort } from '@/features/driver-planning/utils/format-date'
import { sameDayCheck } from '@/features/driver-planning/utils/date'
import { HoverToolTip } from '@/features/driver-planning/containers/ToolTips'

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
// Each row renders:
//   [start] [estimated-or-actual] [end], <STATE> <City> <confidence-icon>
//
// Collapsing: when the estimated/actual date matches the spread's start or
// end (calendar-day compare via sameDayCheck), the duplicate bound is omitted
// so the row reads cleanly. The estimated/actual date itself is bolded and
// color-coded to the confidence tier; the matching Font Awesome glyph mirrors
// the ActivityGantt convention (truck = actual, flag = confirmed, check =
// committed).
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

function DeliveryLine({ delivery }: { delivery: Delivery }) {
  const tier = getConfidenceTier(delivery)
  const effective = delivery.actualDate ?? delivery.estimatedDate ?? null
  const start = delivery.plannedStart
  const end = delivery.plannedEnd

  const startStr = start ? formatDateShort(start) : ''
  const endStr = end ? formatDateShort(end) : ''
  const effStr = effective ? formatDateShort(effective) : ''

  const collapseStart = effective != null && sameDayCheck(effective, start)
  const collapseEnd = effective != null && sameDayCheck(effective, end)
  const boldClass = `font-semibold ${tier.colorClass}`.trim()

  // Build the date segment depending on collapsing.
  let dateSegment: React.ReactNode
  if (!effective) {
    // No estimated/actual yet — render the bare spread.
    if (startStr && endStr) {
      dateSegment = `${startStr} – ${endStr}`
    } else {
      dateSegment = startStr || endStr || '-'
    }
  } else if (collapseStart && collapseEnd) {
    dateSegment = (
      <span className={boldClass} data-testid="delivery-effective">
        {effStr}
      </span>
    )
  } else if (collapseStart) {
    dateSegment = (
      <>
        <span className={boldClass} data-testid="delivery-effective">
          {effStr}
        </span>
        {' – '}
        {endStr}
      </>
    )
  } else if (collapseEnd) {
    dateSegment = (
      <>
        {startStr}
        {' – '}
        <span className={boldClass} data-testid="delivery-effective">
          {effStr}
        </span>
      </>
    )
  } else {
    dateSegment = (
      <>
        {startStr}
        {' – '}
        <span className={boldClass} data-testid="delivery-effective">
          {effStr}
        </span>
        {' – '}
        {endStr}
      </>
    )
  }

  return (
    <li
      className="flex items-center gap-1.5 text-xs whitespace-nowrap"
      data-testid="delivery-line"
      data-activity-id={delivery.activityId}
    >
      <span>{dateSegment}</span>
      {(delivery.state || delivery.city) && (
        <span>
          , {delivery.state && <b>{delivery.state}</b>}
          {delivery.state && delivery.city ? ' ' : ''}
          {titleCaseCity(delivery.city)}
        </span>
      )}
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
    </li>
  )
}

function DriverRow({ driver }: { driver: DriverPlanningRow }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<EditState>({
    confirmedDate: toInputDate(driver.confirmedAvailableDate),
    confirmedLocation: driver.confirmedAvailableLocation ?? '',
    notes: driver.confirmedNotes ?? '',
  })

  const mutation = useUpdateConfirmedAvailability()

  function handleSave() {
    mutation.mutate(
      {
        driverId: driver.driverId,
        confirmedDate: form.confirmedDate || null,
        confirmedLocation: form.confirmedLocation || null,
        notes: form.notes || null,
      },
      {
        onSuccess: () => setEditing(false),
      },
    )
  }

  function handleCancel() {
    setForm({
      confirmedDate: toInputDate(driver.confirmedAvailableDate),
      confirmedLocation: driver.confirmedAvailableLocation ?? '',
      notes: driver.confirmedNotes ?? '',
    })
    setEditing(false)
  }

  return (
    <TableRow data-testid="driver-row" data-driver-id={driver.driverId}>
      <TableCell className="font-medium" data-testid="driver-name">
        {driver.driverName}
      </TableCell>
      <TableCell data-testid="driver-current-trip">
        {driver.currentTripId ? (
          <Badge variant="secondary">
            #{driver.currentTripId}
            {driver.currentTripTitle ? ` - ${driver.currentTripTitle}` : ''}
          </Badge>
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </TableCell>
      <TableCell data-testid="driver-deliveries">
        {driver.deliveries.length === 0 ? (
          <span className="text-muted-foreground">-</span>
        ) : (
          <ul className="space-y-0.5">
            {driver.deliveries.map((d) => (
              <DeliveryLine key={d.activityId} delivery={d} />
            ))}
          </ul>
        )}
      </TableCell>
      <TableCell>
        {editing ? (
          <Input
            type="date"
            data-testid="confirmed-date-input"
            value={form.confirmedDate}
            onChange={(e) => setForm((f) => ({ ...f, confirmedDate: e.target.value }))}
            className="w-40"
          />
        ) : (
          <span
            className="cursor-pointer hover:underline"
            data-testid="confirmed-date-cell"
            onClick={() => setEditing(true)}
          >
            {driver.confirmedAvailableDate ? formatDate(driver.confirmedAvailableDate) : '-'}
          </span>
        )}
      </TableCell>
      <TableCell>
        {editing ? (
          <Input
            type="text"
            data-testid="confirmed-location-input"
            value={form.confirmedLocation}
            onChange={(e) => setForm((f) => ({ ...f, confirmedLocation: e.target.value }))}
            placeholder="City, State"
            className="w-44"
          />
        ) : (
          <span className="cursor-pointer hover:underline" onClick={() => setEditing(true)}>
            {driver.confirmedAvailableLocation ?? '-'}
          </span>
        )}
      </TableCell>
      <TableCell>
        {editing ? (
          <Input
            type="text"
            data-testid="confirmed-notes-input"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Notes"
            className="w-44"
          />
        ) : (
          <span
            className="cursor-pointer hover:underline text-muted-foreground"
            onClick={() => setEditing(true)}
          >
            {driver.confirmedNotes || '-'}
          </span>
        )}
      </TableCell>
      <TableCell>
        {editing ? (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              data-testid="confirmed-save"
              onClick={handleSave}
              disabled={mutation.isPending}
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              data-testid="confirmed-cancel"
              onClick={handleCancel}
              disabled={mutation.isPending}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            data-testid="confirmed-edit"
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}

export function DriverPlanningPage() {
  const { data: drivers, isLoading } = useQuery(driverPlanningQueryOptions)
  const [filter, setFilter] = useState('')

  const filtered = (drivers ?? []).filter((d) =>
    d.driverName.toLowerCase().includes(filter.toLowerCase()),
  )

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
          <Input
            placeholder="Filter by driver name..."
            data-testid="driver-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-sm"
          />
          <div className="rounded-md border">
            <Table data-testid="driver-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Driver</TableHead>
                  <TableHead>Current Trip</TableHead>
                  <TableHead>Deliveries</TableHead>
                  <TableHead>Confirmed Date</TableHead>
                  <TableHead>Confirmed Location</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      No matching drivers.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((driver) => <DriverRow key={driver.driverId} driver={driver} />)
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}
