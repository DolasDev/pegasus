// ---------------------------------------------------------------------------
// Unit tests for summarizeWorkflowHistory — the pure Temporal-history flattener
// behind GET /workflows/:id/executions/:executionId/history. No live Temporal
// connection: it operates on plain History-proto-shaped objects.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { summarizeWorkflowHistory } from './temporal-client'

describe('summarizeWorkflowHistory', () => {
  it('returns an empty list for null / missing / non-array events', () => {
    expect(summarizeWorkflowHistory(null)).toEqual([])
    expect(summarizeWorkflowHistory(undefined)).toEqual([])
    expect(summarizeWorkflowHistory({})).toEqual([])
    expect(summarizeWorkflowHistory({ events: 'nope' })).toEqual([])
  })

  it('flattens a started → scheduled → failed sequence with name correlation', () => {
    const events = summarizeWorkflowHistory({
      events: [
        {
          eventId: 1,
          eventTime: { seconds: 1_700_000_000, nanos: 0 },
          workflowExecutionStartedEventAttributes: {},
        },
        {
          eventId: 5,
          eventTime: { seconds: 1_700_000_001, nanos: 500_000_000 },
          activityTaskScheduledEventAttributes: { activityType: { name: 'compose_followup' } },
        },
        {
          eventId: 6,
          eventTime: { seconds: 1_700_000_002, nanos: 0 },
          activityTaskStartedEventAttributes: { scheduledEventId: 5, attempt: 2 },
        },
        {
          eventId: 7,
          eventTime: { seconds: 1_700_000_003, nanos: 0 },
          activityTaskFailedEventAttributes: {
            scheduledEventId: 5,
            failure: { message: 'boom 401' },
          },
        },
      ],
    })

    expect(events.map((e) => e.type)).toEqual([
      'WorkflowExecutionStarted',
      'ActivityTaskScheduled',
      'ActivityTaskStarted',
      'ActivityTaskFailed',
    ])
    // Scheduled carries the name directly; later events correlate via scheduledEventId.
    expect(events[1]).toMatchObject({ activityType: 'compose_followup' })
    expect(events[2]).toMatchObject({ activityType: 'compose_followup', attempt: 2 })
    expect(events[3]).toMatchObject({ activityType: 'compose_followup', failure: 'boom 401' })
    // Timestamps are ISO strings (with sub-second nanos folded in).
    expect(events[0]?.timestamp).toBe('2023-11-14T22:13:20.000Z')
    expect(events[1]?.timestamp).toBe('2023-11-14T22:13:21.500Z')
  })

  it('handles Long-like proto seconds (toString) and missing timestamps', () => {
    const events = summarizeWorkflowHistory({
      events: [
        {
          eventId: { toString: () => '1' },
          eventTime: { seconds: { toString: () => '1700000000' }, nanos: 0 },
          workflowExecutionCompletedEventAttributes: {},
        },
        { eventId: 2, workflowExecutionTimedOutEventAttributes: {} },
      ],
    })
    expect(events[0]).toMatchObject({ id: '1', type: 'WorkflowExecutionCompleted' })
    expect(events[0]?.timestamp).toBe('2023-11-14T22:13:20.000Z')
    expect(events[1]).toMatchObject({ id: '2', type: 'WorkflowExecutionTimedOut', timestamp: null })
  })

  it('labels an unrecognized event Unknown rather than dropping it', () => {
    const events = summarizeWorkflowHistory({
      events: [{ eventId: 9, someBrandNewEventAttributes: {} }],
    })
    expect(events).toEqual([{ id: '9', type: 'Unknown', timestamp: null }])
  })
})
