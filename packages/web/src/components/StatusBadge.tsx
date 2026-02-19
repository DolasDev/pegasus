import type { MoveStatus, QuoteStatus, InvoiceStatus } from '@pegasus/domain'
import { Badge } from '@/components/ui/badge'

// ---------------------------------------------------------------------------
// MoveStatus badge
// ---------------------------------------------------------------------------
const MOVE_STATUS_VARIANT: Record<MoveStatus, 'muted' | 'info' | 'warning' | 'success' | 'destructive'> = {
  PENDING: 'muted',
  SCHEDULED: 'info',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
}

const MOVE_STATUS_LABEL: Record<MoveStatus, string> = {
  PENDING: 'Pending',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

export function MoveStatusBadge({ status }: { status: MoveStatus }) {
  return <Badge variant={MOVE_STATUS_VARIANT[status]}>{MOVE_STATUS_LABEL[status]}</Badge>
}

// ---------------------------------------------------------------------------
// QuoteStatus badge
// ---------------------------------------------------------------------------
const QUOTE_STATUS_VARIANT: Record<QuoteStatus, 'muted' | 'info' | 'warning' | 'success' | 'destructive'> = {
  DRAFT: 'muted',
  SENT: 'info',
  ACCEPTED: 'success',
  REJECTED: 'destructive',
  EXPIRED: 'warning',
}

const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
}

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  return <Badge variant={QUOTE_STATUS_VARIANT[status]}>{QUOTE_STATUS_LABEL[status]}</Badge>
}

// ---------------------------------------------------------------------------
// InvoiceStatus badge
// ---------------------------------------------------------------------------
const INVOICE_STATUS_VARIANT: Record<InvoiceStatus, 'muted' | 'info' | 'warning' | 'success' | 'destructive'> = {
  DRAFT: 'muted',
  ISSUED: 'info',
  PAID: 'success',
  PARTIALLY_PAID: 'warning',
  VOID: 'destructive',
}

const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  PAID: 'Paid',
  PARTIALLY_PAID: 'Partial',
  VOID: 'Void',
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge variant={INVOICE_STATUS_VARIANT[status]}>{INVOICE_STATUS_LABEL[status]}</Badge>
}
