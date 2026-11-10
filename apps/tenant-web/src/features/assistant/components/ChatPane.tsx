// Assistant Lab — Chat. Runs as the logged-in user's real principal, so the
// tools offered and the rows returned are exactly what this user may see.

import { useEffect, useReducer, useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { assistantKeys, streamChat, type Effort } from '@/api/assistant'
import { ApiError } from '@/api/client'
import {
  applyEvent,
  failTurn,
  initialChatState,
  startTurn,
  type ChatState,
  type ToolActivity,
} from '../chat-state'
import type { SseEvent } from '@pegasus/api-http'

type Action =
  | { type: 'start'; question: string }
  | { type: 'event'; event: SseEvent }
  | { type: 'fail'; message: string }
  | { type: 'reset' }

function reducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case 'start':
      return startTurn(state, action.question)
    case 'event':
      return applyEvent(state, action.event)
    case 'fail':
      return failTurn(state, action.message)
    case 'reset':
      return initialChatState
  }
}

const TOOL_STATUS: Record<
  ToolActivity['status'],
  { label: string; variant: 'info' | 'success' | 'destructive' | 'warning' }
> = {
  running: { label: 'running', variant: 'info' },
  done: { label: 'done', variant: 'success' },
  denied: { label: 'denied', variant: 'destructive' },
  error: { label: 'error', variant: 'warning' },
}

export function ChatPane({
  promptVersionId,
  effort,
}: {
  /** A draft to chat against instead of the published prompt. */
  promptVersionId: string | null
  effort: Effort
}) {
  const [state, dispatch] = useReducer(reducer, initialChatState)
  const [question, setQuestion] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const qc = useQueryClient()

  useEffect(() => () => abortRef.current?.abort(), [])

  async function ask(e: FormEvent) {
    e.preventDefault()
    const q = question.trim()
    if (!q || state.streaming) return
    setQuestion('')
    dispatch({ type: 'start', question: q })
    const controller = new AbortController()
    abortRef.current = controller
    try {
      for await (const event of streamChat(
        {
          question: q,
          effort,
          ...(state.conversationId ? { conversationId: state.conversationId } : {}),
          ...(promptVersionId ? { promptVersionId } : {}),
        },
        controller.signal,
      )) {
        dispatch({ type: 'event', event })
      }
    } catch (err) {
      if (controller.signal.aborted) {
        dispatch({ type: 'fail', message: 'Stopped.' })
      } else {
        dispatch({
          type: 'fail',
          message: err instanceof ApiError ? err.message : 'Could not reach the assistant.',
        })
      }
    } finally {
      void qc.invalidateQueries({ queryKey: assistantKeys.conversations() })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Prompt:</span>
        <Badge variant={promptVersionId ? 'warning' : 'muted'}>
          {promptVersionId ? 'draft (Lab only)' : 'published'}
        </Badge>
        <span>Effort: {effort}</span>
        {state.offered.length > 0 && (
          <span>
            Tools offered to you: <span className="font-mono">{state.offered.join(', ')}</span>
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={state.streaming}
          onClick={() => dispatch({ type: 'reset' })}
        >
          New conversation
        </Button>
      </div>

      <div className="min-h-[18rem] space-y-4 rounded-md border bg-background p-4">
        {state.messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ask a question an operations user would ask — for example “which trips are running late
            this week?” — then check the Traces tab to see which tools were called.
          </p>
        )}
        {state.messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <div
              className={
                m.role === 'user'
                  ? 'inline-block rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
                  : 'inline-block max-w-full whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-left text-sm'
              }
            >
              {m.tools.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {m.tools.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center gap-2 text-xs text-muted-foreground"
                    >
                      <Badge variant={TOOL_STATUS[t.status].variant}>
                        {TOOL_STATUS[t.status].label}
                      </Badge>
                      <span className="font-mono">{t.name}</span>
                      {t.resultCount !== null && <span>{t.resultCount} rows</span>}
                      {t.durationMs !== null && <span>{(t.durationMs / 1000).toFixed(1)}s</span>}
                    </li>
                  ))}
                </ul>
              )}
              {m.text ||
                (m.role === 'assistant' && state.streaming && i === state.messages.length - 1
                  ? '…'
                  : '')}
            </div>
          </div>
        ))}
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      </div>

      {state.lastTurn && (
        <p className="text-xs text-muted-foreground">
          Last answer: {state.lastTurn.rounds} model round(s), {state.lastTurn.inputTokens} input /{' '}
          {state.lastTurn.outputTokens} output tokens,{' '}
          <span className={state.lastTurn.cacheReadTokens > 0 ? '' : 'text-yellow-700'}>
            {state.lastTurn.cacheReadTokens} cached
          </span>
          , {(state.lastTurn.latencyMs / 1000).toFixed(1)}s.
        </p>
      )}

      <form onSubmit={(e) => void ask(e)} className="flex gap-2">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about shipments, trips, drivers…"
          maxLength={4000}
          disabled={state.streaming}
        />
        {state.streaming ? (
          <Button type="button" variant="outline" onClick={() => abortRef.current?.abort()}>
            Stop
          </Button>
        ) : (
          <Button type="submit" disabled={!question.trim()}>
            Ask
          </Button>
        )}
      </form>
    </div>
  )
}
