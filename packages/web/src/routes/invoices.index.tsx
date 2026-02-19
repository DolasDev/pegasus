import { useQuery } from '@tanstack/react-query'
import type { Invoice } from '@pegasus/domain'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { InvoiceStatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { invoicesQueryOptions } from '@/api/queries/billing'

const columns: Column<Invoice>[] = [
  { key: 'id', header: 'ID', sortable: true },
  { key: 'moveId', header: 'Move ID', sortable: true },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => <InvoiceStatusBadge status={row.status} />,
  },
  {
    key: 'total',
    header: 'Total',
    cell: (row) =>
      typeof row.total === 'object' && row.total !== null
        ? `${row.total.currency} ${Number(row.total.amount).toFixed(2)}`
        : String(row.total),
  },
]

export function InvoicesPage() {
  const { data: invoices = [], isLoading } = useQuery(invoicesQueryOptions)

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Billing" breadcrumbs={[{ label: 'Billing' }]} />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Billing" breadcrumbs={[{ label: 'Billing' }]} />
      {invoices.length === 0 ? (
        <EmptyState title="No invoices yet" description="Invoices appear once generated from accepted quotes." />
      ) : (
        <DataTable
          data={invoices as unknown as Record<string, unknown>[]}
          columns={columns as unknown as Column<Record<string, unknown>>[]}
          pageSize={15}
        />
      )}
    </div>
  )
}
