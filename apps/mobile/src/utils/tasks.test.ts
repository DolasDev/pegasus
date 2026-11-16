import type { DriverTask } from '../types/tasks'
import { dueCount, groupTasks, topTasks } from './tasks'

function task(over: Partial<DriverTask>): DriverTask {
  return {
    key: 'task:submit-arrival-times:100:k',
    rule: 'submit-arrival-times',
    orderNum: 100,
    shipperName: 'SMITH',
    title: 'Mark Pack done',
    due: '2026-11-16',
    bucket: 'today',
    target: { kind: 'mark-done', itemKey: 'k', day: '2026-11-16' },
    ...over,
  }
}

const A = task({ key: 'a', bucket: 'overdue', orderNum: 200, due: '2026-11-10' })
const B = task({ key: 'b', bucket: 'overdue', orderNum: 100, due: '2026-11-12' })
const C = task({ key: 'c', bucket: 'overdue', orderNum: 200, due: '2026-11-13' })
const D = task({ key: 'd', bucket: 'today' })
const E = task({ key: 'e', bucket: 'upcoming', due: '2026-11-17' })

describe('groupTasks', () => {
  it('sections Overdue / Today / Upcoming, grouped by order in API order', () => {
    const sections = groupTasks([A, B, C, D, E])
    expect(sections.map((s) => s.title)).toEqual(['Overdue', 'Today', 'Upcoming'])
    expect(sections[0]!.orders.map((g) => [g.orderNum, g.tasks.map((t) => t.key)])).toEqual([
      [200, ['a', 'c']],
      [100, ['b']],
    ])
  })

  it('omits empty sections', () => {
    expect(groupTasks([D]).map((s) => s.bucket)).toEqual(['today'])
    expect(groupTasks([])).toEqual([])
  })
})

describe('topTasks / dueCount', () => {
  it('takes overdue before today, never upcoming', () => {
    expect(topTasks([E, D, A, B]).map((t) => t.key)).toEqual(['a', 'b', 'd'])
    expect(topTasks([E]).map((t) => t.key)).toEqual([])
  })

  it('counts overdue + today', () => {
    expect(dueCount([A, D, E])).toBe(2)
  })
})
