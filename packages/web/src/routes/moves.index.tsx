import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { Move } from '@pegasus/domain'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { MoveStatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { movesQueryOptions } from '@/api/queries/moves'

const columns: Column<Move>[] = [
  { key: 'id', header: 'ID', sortable: true },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => <MoveStatusBadge status={row.status} />,
  },
  {
    key: 'scheduledDate',
    header: 'Scheduled',
    cell: (row) =>
      row.scheduledDate instanceof Date
        ? row.scheduledDate.toLocaleDateString()
        : String(row.scheduledDate).slice(0, 10),
    sortable: true,
  },
  {
    key: 'origin',
    header: 'Origin',
    cell: (row) => row.origin.city + ', ' + row.origin.state,
  },
  {
    key: 'destination',
    header: 'Destination',
    cell: (row) => row.destination.city + ', ' + row.destination.state,
  },
]

export function MovesPage() {
  const { data: moves = [], isLoading } = useQuery(movesQueryOptions)
  const navigate = useNavigate()

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Moves" breadcrumbs={[{ label: 'Moves' }]} />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Moves" breadcrumbs={[{ label: 'Moves' }]} />
      {moves.length === 0 ? (
        <EmptyState title="No moves yet" description="Moves will appear here once created." />
      ) : (
        <DataTable
          data={moves as unknown as Record<string, unknown>[]}
          columns={columns as unknown as Column<Record<string, unknown>>[]}
          filterKey="id"
          filterPlaceholder="Filter by ID…"
          pageSize={15}
        />
      )}
    </div>
  )
}
