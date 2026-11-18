import { Link } from '@tanstack/react-router'
import { Workflow as WorkflowIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The Automations lists show one-shot Automations only. This line points at
 * /workflows, where durable (long-running) Workflow instances are listed.
 */
export function DurableWorkflowsPointer({ className }: { className?: string }) {
  return (
    <p className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
      <WorkflowIcon className="h-4 w-4 shrink-0" />
      <span>
        Long-running Workflows are listed separately:{' '}
        <Link to="/workflows" className="text-primary hover:underline">
          Durable Workflows →
        </Link>
      </span>
    </p>
  )
}
