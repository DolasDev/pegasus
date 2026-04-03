import { useQuery } from '@tanstack/react-query'
import type { Customer } from '@pegasus/domain'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { customersQueryOptions } from '@/api/queries/customers'

const columns: Column<Customer>[] = [
  { key: 'id', header: 'ID', sortable: true },
  { key: 'firstName', header: 'First Name', sortable: true },
  { key: 'lastName', header: 'Last Name', sortable: true },
  { key: 'email', header: 'Email', sortable: true },
  {
    key: 'phone',
    header: 'Phone',
    cell: (row) => row.phone ?? '—',
  },
]

export function CustomersPage() {
  const { data: customers = [], isLoading } = useQuery(customersQueryOptions)

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Customers" breadcrumbs={[{ label: 'Customers' }]} />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Customers" breadcrumbs={[{ label: 'Customers' }]} />
      {customers.length === 0 ? (
        <EmptyState
          title="No customers yet"
          description="Customers will appear here once created."
        />
      ) : (
        <DataTable
          data={customers as unknown as Record<string, unknown>[]}
          columns={columns as unknown as Column<Record<string, unknown>>[]}
          filterKey="lastName"
          filterPlaceholder="Filter by last name…"
          pageSize={15}
        />
      )}
    </div>
  )
}
