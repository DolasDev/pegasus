import { useQuery } from '@tanstack/react-query'
import type { Quote } from '@pegasus/domain'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { QuoteStatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { quotesQueryOptions } from '@/api/queries/quotes'

const columns: Column<Quote>[] = [
  { key: 'id', header: 'ID', sortable: true },
  { key: 'moveId', header: 'Move ID', sortable: true },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => <QuoteStatusBadge status={row.status} />,
  },
  {
    key: 'price',
    header: 'Price',
    cell: (row) =>
      typeof row.price === 'object' && row.price !== null
        ? `${row.price.currency} ${Number(row.price.amount).toFixed(2)}`
        : String(row.price),
  },
  {
    key: 'validUntil',
    header: 'Valid Until',
    cell: (row) =>
      row.validUntil instanceof Date
        ? row.validUntil.toLocaleDateString()
        : String(row.validUntil).slice(0, 10),
    sortable: true,
  },
]

export function QuotesPage() {
  const { data: quotes = [], isLoading } = useQuery(quotesQueryOptions)

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Quotes" breadcrumbs={[{ label: 'Quotes' }]} />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Quotes" breadcrumbs={[{ label: 'Quotes' }]} />
      {quotes.length === 0 ? (
        <EmptyState title="No quotes yet" description="Quotes will appear here once created." />
      ) : (
        <DataTable
          data={quotes as unknown as Record<string, unknown>[]}
          columns={columns as unknown as Column<Record<string, unknown>>[]}
          filterKey="id"
          filterPlaceholder="Filter by ID…"
          pageSize={15}
        />
      )}
    </div>
  )
}
