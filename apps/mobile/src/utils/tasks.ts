import type { TaskBucket } from '@pegasus/domain'
import type { DriverTask } from '../types/tasks'

// ---------------------------------------------------------------------------
// To Do screen grouping: Overdue / Today / Upcoming, each grouped by order.
// The API already sorts oldest due first, then by order; grouping keeps that
// order (an order sits where its first task falls).
// ---------------------------------------------------------------------------

export const BUCKET_TITLES: Record<TaskBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
}

const BUCKETS: TaskBucket[] = ['overdue', 'today', 'upcoming']

export interface TaskOrderGroup {
  orderNum: number
  shipperName: string | null
  tasks: DriverTask[]
}

export interface TaskSection {
  bucket: TaskBucket
  title: string
  orders: TaskOrderGroup[]
}

/** Non-empty sections only. */
export function groupTasks(tasks: readonly DriverTask[]): TaskSection[] {
  const out: TaskSection[] = []
  for (const bucket of BUCKETS) {
    const orders = new Map<number, TaskOrderGroup>()
    for (const t of tasks) {
      if (t.bucket !== bucket) continue
      const g = orders.get(t.orderNum)
      if (g) g.tasks.push(t)
      else orders.set(t.orderNum, { orderNum: t.orderNum, shipperName: t.shipperName, tasks: [t] })
    }
    if (orders.size > 0)
      out.push({ bucket, title: BUCKET_TITLES[bucket], orders: [...orders.values()] })
  }
  return out
}

/** Overdue first, then today — the Dashboard's "Top 3". Upcoming never makes it. */
export function topTasks(tasks: readonly DriverTask[], n = 3): DriverTask[] {
  return [
    ...tasks.filter((t) => t.bucket === 'overdue'),
    ...tasks.filter((t) => t.bucket === 'today'),
  ].slice(0, n)
}

/** The drawer badge: what needs doing now (overdue + today). */
export function dueCount(tasks: readonly DriverTask[]): number {
  return tasks.filter((t) => t.bucket !== 'upcoming').length
}
