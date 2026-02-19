import { PageHeader } from '@/components/PageHeader'

export function DispatchPage() {
  return (
    <div>
      <PageHeader title="Dispatch" breadcrumbs={[{ label: 'Dispatch' }]} />
      {/* TODO: Dispatch board — Kanban-style view of moves by status */}
    </div>
  )
}
