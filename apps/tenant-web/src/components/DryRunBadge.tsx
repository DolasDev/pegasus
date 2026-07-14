import { FlaskConical } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

/**
 * Marks an execution as a dry run (a benign rehearsal — reads live, mutations
 * captured not performed). Used on execution rows in the workflow list and
 * detail views.
 */
export function DryRunBadge() {
  return (
    <Badge variant="warning" className="gap-1 text-xs">
      <FlaskConical className="h-3 w-3" />
      Dry run
    </Badge>
  )
}
