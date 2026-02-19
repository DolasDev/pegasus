import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { PageHeader } from '@/components/PageHeader'
import { QuoteStatusBadge } from '@/components/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { quoteDetailQueryOptions, useFinalizeQuote } from '@/api/queries/quotes'

export function QuoteDetailPage() {
  const { quoteId } = useParams({ strict: false }) as { quoteId: string }
  const { data: quote, isLoading } = useQuery(quoteDetailQueryOptions(quoteId ?? ''))
  const finalizeQuote = useFinalizeQuote()

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  if (!quote) {
    return <EmptyState title="Quote not found" />
  }

  return (
    <div>
      <PageHeader
        title={`Quote ${String(quote.id).slice(0, 8)}…`}
        breadcrumbs={[{ label: 'Quotes', href: '/quotes' }, { label: 'Detail' }]}
        action={
          <div className="flex items-center gap-2">
            <QuoteStatusBadge status={quote.status} />
            {quote.status === 'DRAFT' && (
              <Button
                size="sm"
                onClick={() => finalizeQuote.mutate(String(quote.id))}
                disabled={finalizeQuote.isPending}
              >
                Finalize
              </Button>
            )}
          </div>
        }
      />

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Move: </span>
              {String(quote.moveId)}
            </p>
            <p>
              <span className="text-muted-foreground">Total: </span>
              {quote.price.currency} {Number(quote.price.amount).toFixed(2)}
            </p>
            <p>
              <span className="text-muted-foreground">Valid Until: </span>
              {quote.validUntil instanceof Date
                ? quote.validUntil.toLocaleDateString()
                : String(quote.validUntil).slice(0, 10)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Line Items</CardTitle>
          </CardHeader>
          <CardContent>
            {!quote.lineItems || quote.lineItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No line items.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quote.lineItems.map((item) => (
                    <TableRow key={String(item.id)}>
                      <TableCell>{item.description}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">
                        {item.unitPrice.currency} {Number(item.unitPrice.amount).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.unitPrice.currency}{' '}
                        {(item.quantity * Number(item.unitPrice.amount)).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
