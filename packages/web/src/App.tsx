import type { FC } from 'react'
import type { MoveStatus } from '@pegasus/domain'

const STATUS_LABELS: Record<MoveStatus, string> = {
  PENDING: 'Pending',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

export const App: FC = () => {
  return (
    <main>
      <h1>Pegasus</h1>
      <p>Move Management Platform</p>
      <ul>
        {(Object.keys(STATUS_LABELS) as MoveStatus[]).map((status) => (
          <li key={status}>{STATUS_LABELS[status]}</li>
        ))}
      </ul>
    </main>
  )
}
