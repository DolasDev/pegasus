import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { QuoteStatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { customerDetailQueryOptions } from '@/api/queries/customers'
import { customerQuotesQueryOptions } from '@/api/queries/quotes'

export function CustomerDetailPage() {
  const { customerId } = useParams({ strict: false }) as { customerId: string }
  const { data: customer, isLoading } = useQuery(customerDetailQueryOptions(customerId ?? ''))
  const { data: quotes = [] } = useQuery(customerQuotesQueryOptions(customerId ?? ''))

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  if (!customer) {
    return <EmptyState title="Customer not found" />
  }

  return (
    <div>
      <PageHeader
        title={`${customer.firstName} ${customer.lastName}`}
        breadcrumbs={[{ label: 'Customers', href: '/customers' }, { label: 'Detail' }]}
      />

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Email: </span>
              {customer.email}
            </p>
            {customer.phone && (
              <p>
                <span className="text-muted-foreground">Phone: </span>
                {customer.phone}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quotes</CardTitle>
          </CardHeader>
          <CardContent>
            {quotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No quotes for this customer.</p>
            ) : (
              <ul className="space-y-2">
                {quotes.map((q) => (
                  <li key={String(q.id)} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs">{String(q.id).slice(0, 12)}…</span>
                    <div className="flex items-center gap-2">
                      <span>
                        {q.price.currency} {Number(q.price.amount).toFixed(2)}
                      </span>
                      <QuoteStatusBadge status={q.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
