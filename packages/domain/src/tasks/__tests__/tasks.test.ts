import { describe, expect, it } from 'vitest'
import {
  DRIVER_TASK_RULES,
  evaluateDriverTasks,
  isDriverTaskRuleId,
  taskBucket,
  taskKey,
  type DriverTaskFacts,
  type DriverTaskRuleId,
  type TaskAct,
} from '../index'

const TODAY = '2026-11-16'

function act(over: Partial<TaskAct> = {}): TaskAct {
  return {
    itemKey: 'longhaul-activity:1',
    source: 'longhaul-activity',
    orderNum: 100,
    shipperName: 'SMITH',
    actCode: 'PACK',
    actName: 'Pack',
    kind: 'act',
    known: true,
    day: TODAY,
    legacyDone: false,
    assertedDone: null,
    ...over,
  }
}

function facts(
  acts: TaskAct[],
  over: Partial<DriverTaskFacts> = {},
  rules: DriverTaskRuleId[] = [...DRIVER_TASK_RULES],
): DriverTaskFacts {
  return {
    today: TODAY,
    acts,
    documentTypesByOrder: new Map(),
    enabledRules: new Set(rules),
    ...over,
  }
}

describe('taskBucket', () => {
  it('splits on the driver’s day', () => {
    expect(taskBucket('2026-11-15', TODAY)).toBe('overdue')
    expect(taskBucket(TODAY, TODAY)).toBe('today')
    expect(taskBucket('2026-11-17', TODAY)).toBe('upcoming')
  })
})

describe('isDriverTaskRuleId', () => {
  it('accepts only the built-in rules', () => {
    expect(isDriverTaskRuleId('submit-bol')).toBe(true)
    expect(isDriverTaskRuleId('submit-anything')).toBe(false)
    expect(isDriverTaskRuleId(3)).toBe(false)
  })
})

describe('submit-arrival-times', () => {
  const only: DriverTaskRuleId[] = ['submit-arrival-times']

  it('asks for today’s and past acts that nobody marked done', () => {
    const tasks = evaluateDriverTasks(
      facts(
        [
          act({ itemKey: 'a', day: '2026-11-14', actName: 'Load', actCode: 'LOAD' }),
          act({ itemKey: 'b', day: TODAY }),
          act({ itemKey: 'c', day: '2026-11-17' }),
        ],
        {},
        only,
      ),
    )
    expect(tasks.map((t) => t.key)).toEqual([
      taskKey('submit-arrival-times', 100, 'a'),
      taskKey('submit-arrival-times', 100, 'b'),
    ])
    expect(tasks[0]).toMatchObject({
      title: 'Mark Load done',
      due: '2026-11-14',
      target: { kind: 'mark-done', itemKey: 'a', day: '2026-11-14' },
    })
  })

  it('is satisfied by a legacy actual or the driver’s DONE fact', () => {
    const tasks = evaluateDriverTasks(
      facts(
        [act({ itemKey: 'a', legacyDone: true }), act({ itemKey: 'b', assertedDone: TODAY })],
        {},
        only,
      ),
    )
    expect(tasks).toEqual([])
  })

  it('produces nothing when the driver’s facts could not be read', () => {
    expect(evaluateDriverTasks(facts([act({ assertedDone: 'unknown' })], {}, only))).toEqual([])
  })

  it('skips storage acts, unknown tokens and code-less local days', () => {
    const tasks = evaluateDriverTasks(
      facts(
        [
          act({ itemKey: 'a', kind: 'storage', actCode: 'SITOUT' }),
          act({ itemKey: 'b', known: false, actCode: 'MILE' }),
          act({ itemKey: 'c', actCode: null }),
        ],
        {},
        only,
      ),
    )
    expect(tasks).toEqual([])
  })
})

describe('submit-bol', () => {
  const only: DriverTaskRuleId[] = ['submit-bol']
  const delivered = (over: Partial<TaskAct> = {}) =>
    act({ actCode: 'RDEL', actName: 'Delivery', legacyDone: true, ...over })

  it('asks once per order after a delivery is done, until a BOL exists', () => {
    const tasks = evaluateDriverTasks(
      facts(
        [
          delivered({ itemKey: 'a', day: '2026-11-13' }),
          delivered({ itemKey: 'b', day: '2026-11-15', actCode: 'XDEL' }),
        ],
        {},
        only,
      ),
    )
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      key: taskKey('submit-bol', 100, 'order'),
      due: '2026-11-15',
      target: { kind: 'upload-document', orderNum: 100, documentType: 'bol' },
    })

    const withBol = evaluateDriverTasks(
      facts([delivered()], { documentTypesByOrder: new Map([[100, new Set(['bol'])]]) }, only),
    )
    expect(withBol).toEqual([])
  })

  it('counts the driver’s DONE as done, and waits while the delivery is open', () => {
    expect(
      evaluateDriverTasks(facts([delivered({ legacyDone: false, assertedDone: TODAY })], {}, only)),
    ).toHaveLength(1)
    expect(evaluateDriverTasks(facts([delivered({ legacyDone: false })], {}, only))).toEqual([])
  })

  it('ignores other acts, and other document types', () => {
    expect(evaluateDriverTasks(facts([act({ legacyDone: true })], {}, only))).toEqual([])
    const photo = evaluateDriverTasks(
      facts([delivered()], { documentTypesByOrder: new Map([[100, new Set(['photo'])]]) }, only),
    )
    expect(photo).toHaveLength(1)
  })

  it('is due on the latest delivery, whatever order the acts arrive in', () => {
    const tasks = evaluateDriverTasks(
      facts(
        [
          delivered({ itemKey: 'late', day: '2026-11-15' }),
          delivered({ itemKey: 'early', day: '2026-11-13' }),
        ],
        {},
        only,
      ),
    )
    expect(tasks.map((t) => t.due)).toEqual(['2026-11-15'])
  })

  it('produces nothing when the documents could not be read', () => {
    expect(evaluateDriverTasks(facts([delivered()], { documentTypesByOrder: null }, only))).toEqual(
      [],
    )
  })

  it('treats a legacy actual as done even when the driver’s facts are unread', () => {
    expect(
      evaluateDriverTasks(facts([delivered({ assertedDone: 'unknown' })], {}, only)),
    ).toHaveLength(1)
    expect(
      evaluateDriverTasks(
        facts([delivered({ legacyDone: false, assertedDone: 'unknown' })], {}, only),
      ),
    ).toEqual([])
  })
})

describe('submit-weight-ticket', () => {
  const only: DriverTaskRuleId[] = ['submit-weight-ticket']
  const loaded = (over: Partial<TaskAct> = {}) =>
    act({ actCode: 'LOAD', actName: 'Load', legacyDone: true, ...over })

  it('asks after a longhaul load, until a weight ticket exists', () => {
    expect(evaluateDriverTasks(facts([loaded()], {}, only))).toMatchObject([
      {
        key: taskKey('submit-weight-ticket', 100, 'order'),
        target: { documentType: 'weight_ticket' },
      },
    ])
    expect(
      evaluateDriverTasks(facts([loaded({ source: 'order-assigned', actCode: 'R19O' })], {}, only)),
    ).toHaveLength(1)
    const ticketed = evaluateDriverTasks(
      facts(
        [loaded()],
        { documentTypesByOrder: new Map([[100, new Set(['weight_ticket'])]]) },
        only,
      ),
    )
    expect(ticketed).toEqual([])
  })

  it('does not weigh a local job’s load', () => {
    expect(evaluateDriverTasks(facts([loaded({ source: 'local-job-token' })], {}, only))).toEqual(
      [],
    )
  })
})

describe('evaluateDriverTasks', () => {
  it('runs only the enabled rules', () => {
    const acts = [act({ actCode: 'RDEL', day: '2026-11-15' })]
    expect(evaluateDriverTasks(facts(acts, {}, []))).toEqual([])
    expect(evaluateDriverTasks(facts(acts, {}, ['submit-bol']))).toEqual([])
  })

  it('breaks a tie on due and order by key', () => {
    const tasks = evaluateDriverTasks(
      facts([act({ itemKey: 'b' }), act({ itemKey: 'a' })], {}, ['submit-arrival-times']),
    )
    expect(tasks.map((t) => t.target)).toMatchObject([{ itemKey: 'a' }, { itemKey: 'b' }])
  })

  it('sorts oldest due first, then by order', () => {
    const tasks = evaluateDriverTasks(
      facts(
        [
          act({ itemKey: 'x', orderNum: 300, day: TODAY }),
          act({ itemKey: 'y', orderNum: 200, day: TODAY }),
          act({ itemKey: 'z', orderNum: 400, day: '2026-11-10' }),
          act({ itemKey: 'w', orderNum: 200, day: TODAY, actCode: 'RDEL', legacyDone: true }),
        ],
        {},
      ),
    )
    expect(tasks.map((t) => [t.orderNum, t.rule])).toEqual([
      [400, 'submit-arrival-times'],
      [200, 'submit-arrival-times'],
      [200, 'submit-bol'],
      [300, 'submit-arrival-times'],
    ])
  })
})
