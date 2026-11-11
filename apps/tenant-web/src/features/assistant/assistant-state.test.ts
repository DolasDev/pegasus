import { describe, it, expect } from 'vitest'
import { applyEvent, failTurn, initialChatState, startTurn, type ChatState } from './chat-state'
import { diffRuns } from './eval-diff'
import type { EvalCaseResult } from '@/api/assistant'

const fold = (s: ChatState, events: Array<[string, unknown]>) =>
  events.reduce((acc, [event, data]) => applyEvent(acc, { event, data }), s)

describe('chat-state', () => {
  it('renders a streamed answer incrementally, with tool activity, then settles on done', () => {
    let s = startTurn(initialChatState, 'which trips are late?')
    s = fold(s, [
      ['conversation', { conversationId: 'c1' }],
      ['tools', { offered: ['get_trip', 'search_trips'] }],
      ['text', { text: 'Looking ' }],
      ['tool_start', { id: 't1', name: 'search_trips', input: { planned_from: '2026-11-09' } }],
    ])
    expect(s.streaming).toBe(true)
    expect(s.conversationId).toBe('c1')
    expect(s.messages.at(-1)).toMatchObject({ role: 'assistant', text: 'Looking ' })
    expect(s.messages.at(-1)!.tools[0]).toMatchObject({ name: 'search_trips', status: 'running' })

    s = fold(s, [
      [
        'tool_end',
        {
          id: 't1',
          name: 'search_trips',
          allowed: true,
          isError: false,
          resultCount: 3,
          durationMs: 420,
        },
      ],
      ['text', { text: 'it up. Trips 1, 2.' }],
      [
        'done',
        {
          conversationId: 'c1',
          turnId: 'turn-1',
          text: 'Trips 1 and 2 are late.',
          usage: { inputTokens: 900, outputTokens: 40, cacheReadTokens: 800 },
          rounds: 2,
          latencyMs: 5100,
        },
      ],
    ])
    expect(s.streaming).toBe(false)
    expect(s.messages.at(-1)!.text).toBe('Trips 1 and 2 are late.')
    expect(s.messages.at(-1)!.tools[0]).toMatchObject({
      status: 'done',
      resultCount: 3,
      durationMs: 420,
    })
    expect(s.lastTurn).toMatchObject({ turnId: 'turn-1', cacheReadTokens: 800, rounds: 2 })
    expect(s.offered).toEqual(['get_trip', 'search_trips'])
  })

  it('marks a denied tool distinctly from an erroring one', () => {
    let s = startTurn(initialChatState, 'q')
    s = fold(s, [
      ['tool_start', { id: 'a', name: 'list_invoices' }],
      ['tool_start', { id: 'b', name: 'get_trip' }],
      ['tool_end', { id: 'a', allowed: false, isError: true }],
      ['tool_end', { id: 'b', allowed: true, isError: true }],
    ])
    expect(s.messages.at(-1)!.tools.map((t) => t.status)).toEqual(['denied', 'error'])
  })

  it('surfaces a stream error and a transport failure', () => {
    let s = fold(startTurn(initialChatState, 'q'), [['error', { message: 'boom' }]])
    expect(s.error).toBe('boom')
    s = failTurn(startTurn(initialChatState, 'q'), 'network down')
    expect(s).toMatchObject({ streaming: false, error: 'network down' })
  })
})

describe('diffRuns', () => {
  const r = (id: string, verdict: EvalCaseResult['verdict']): EvalCaseResult => ({
    id,
    askedAs: 'operations_admin',
    verdict,
    reasons: [],
    answer: '',
    toolsCalled: [],
    toolsOffered: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    latencyMs: 0,
  })

  it('classifies each case against the baseline run', () => {
    const out = diffRuns(
      [
        r('a', 'pass'),
        r('b', 'fail'),
        r('c', 'pass'),
        r('d', 'fail'),
        r('e', 'ungraded'),
        r('f', 'pass'),
      ],
      [r('a', 'fail'), r('b', 'pass'), r('c', 'pass'), r('d', 'error'), r('e', 'pass')],
    )
    expect(out.cases.map((c) => [c.id, c.change])).toEqual([
      ['a', 'fixed'],
      ['b', 'regressed'],
      ['c', 'still-passing'],
      ['d', 'still-failing'],
      ['e', 'ungraded'],
      ['f', 'new'],
    ])
    expect(out).toMatchObject({ fixed: 1, regressed: 1 })
  })
})
