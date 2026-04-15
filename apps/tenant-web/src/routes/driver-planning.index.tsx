import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/PageHeader'
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
  type DriverPlanningRow,
} from '@/api/queries/driver-planning'

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
    <TableRow>
      <TableCell className="font-medium">{driver.driverName}</TableCell>
      <TableCell>
        {driver.currentTripId ? (
          <Badge variant="secondary">
            #{driver.currentTripId}
            {driver.currentTripTitle ? ` - ${driver.currentTripTitle}` : ''}
          </Badge>
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </TableCell>
      <TableCell>{formatDate(driver.estimatedAvailableDate)}</TableCell>
      <TableCell>{driver.estimatedAvailableLocation ?? '-'}</TableCell>
      <TableCell>
        {editing ? (
          <Input
            type="date"
            value={form.confirmedDate}
            onChange={(e) => setForm((f) => ({ ...f, confirmedDate: e.target.value }))}
            className="w-40"
          />
        ) : (
          <span className="cursor-pointer hover:underline" onClick={() => setEditing(true)}>
            {driver.confirmedAvailableDate ? formatDate(driver.confirmedAvailableDate) : '-'}
          </span>
        )}
      </TableCell>
      <TableCell>
        {editing ? (
          <Input
            type="text"
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
              onClick={handleSave}
              disabled={mutation.isPending}
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleCancel}
              disabled={mutation.isPending}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
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
      <div>
        <PageHeader title="Driver Planning" breadcrumbs={[{ label: 'Driver Planning' }]} />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Driver Planning" breadcrumbs={[{ label: 'Driver Planning' }]} />
      {(drivers ?? []).length === 0 ? (
        <EmptyState
          title="No drivers found"
          description="Drivers will appear here once available in the system."
        />
      ) : (
        <div className="space-y-3">
          <Input
            placeholder="Filter by driver name..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-sm"
          />
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Driver</TableHead>
                  <TableHead>Current Trip</TableHead>
                  <TableHead>Est. Available Date</TableHead>
                  <TableHead>Est. Available Location</TableHead>
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
                      colSpan={8}
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
