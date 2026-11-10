// Folds the assistant's server-sent events into a chat transcript. Pure, so the
// streaming render is testable without a network or React.

import type { SseEvent } from '@pegasus/api-http'

export interface ToolActivity {
  id: string
  name: string
  input: unknown
  status: 'running' | 'done' | 'denied' | 'error'
  resultCount: number | null
  durationMs: number | null
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  tools: ToolActivity[]
}

export interface ChatState {
  conversationId: string | null
  messages: ChatMessage[]
  /** Tools the model was offered on the latest turn. */
  offered: string[]
  streaming: boolean
  error: string | null
  lastTurn: {
    turnId: string | null
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    rounds: number
    latencyMs: number
  } | null
}

export const initialChatState: ChatState = {
  conversationId: null,
  messages: [],
  offered: [],
  streaming: false,
  error: null,
  lastTurn: null,
}

export function startTurn(state: ChatState, question: string): ChatState {
  return {
    ...state,
    streaming: true,
    error: null,
    messages: [
      ...state.messages,
      { role: 'user', text: question, tools: [] },
      { role: 'assistant', text: '', tools: [] },
    ],
  }
}

function updateLast(state: ChatState, f: (m: ChatMessage) => ChatMessage): ChatState {
  const messages = state.messages.slice()
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant') return state
  messages[messages.length - 1] = f(last)
  return { ...state, messages }
}

type Data = Record<string, unknown>
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

export function applyEvent(state: ChatState, e: SseEvent): ChatState {
  const d = (e.data && typeof e.data === 'object' ? e.data : {}) as Data
  switch (e.event) {
    case 'conversation':
      return { ...state, conversationId: str(d['conversationId']) || state.conversationId }
    case 'tools':
      return { ...state, offered: Array.isArray(d['offered']) ? (d['offered'] as string[]) : [] }
    case 'text':
      return updateLast(state, (m) => ({ ...m, text: m.text + str(d['text']) }))
    case 'tool_start':
      return updateLast(state, (m) => ({
        ...m,
        tools: [
          ...m.tools,
          {
            id: str(d['id']),
            name: str(d['name']),
            input: d['input'],
            status: 'running',
            resultCount: null,
            durationMs: null,
          },
        ],
      }))
    case 'tool_end':
      return updateLast(state, (m) => ({
        ...m,
        tools: m.tools.map((t) =>
          t.id === str(d['id']) && t.status === 'running'
            ? {
                ...t,
                status: d['allowed'] === false ? 'denied' : d['isError'] ? 'error' : 'done',
                resultCount: typeof d['resultCount'] === 'number' ? d['resultCount'] : null,
                durationMs: num(d['durationMs']),
              }
            : t,
        ),
      }))
    case 'error':
      return { ...state, error: str(d['message']) || 'The assistant could not answer.' }
    case 'done': {
      const usage = (d['usage'] ?? {}) as Data
      // The final text is authoritative: streamed deltas include any interim
      // narration from earlier tool rounds, the final answer is the last round.
      const finalText = str(d['text'])
      const next = finalText ? updateLast(state, (m) => ({ ...m, text: finalText })) : state
      return {
        ...next,
        streaming: false,
        conversationId: str(d['conversationId']) || next.conversationId,
        lastTurn: {
          turnId: str(d['turnId']) || null,
          inputTokens: num(usage['inputTokens']),
          outputTokens: num(usage['outputTokens']),
          cacheReadTokens: num(usage['cacheReadTokens']),
          rounds: num(d['rounds']),
          latencyMs: num(d['latencyMs']),
        },
      }
    }
    default:
      return state
  }
}

/** The transport failed (network, auth, feature off) before or during the stream. */
export function failTurn(state: ChatState, message: string): ChatState {
  return { ...state, streaming: false, error: message }
}
