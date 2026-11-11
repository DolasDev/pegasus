// ---------------------------------------------------------------------------
// AI assistant API — /api/v1/assistant (plans/*/ai-chat-assistant.md).
//
// CRUD reads go to the API like everything else. The two streaming calls
// (chat, eval run) go to `assistantUrl` — the assistant Lambda's Function URL —
// because API Gateway buffers responses and cuts them off at 29 s.
// ---------------------------------------------------------------------------

import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { createStreamClient, type SseEvent } from '@pegasus/api-http'
import { apiFetch } from '@/api/client'
import { getConfig } from '@/config'
import { getSession } from '@/auth/session'

export type Effort = 'low' | 'medium' | 'high'

export interface PromptVersion {
  id: string
  version: number
  status: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED'
  systemPrompt: string
  glossary: string
  note: string | null
  authorUserId: string
  publishedBy: string | null
  publishedAt: string | null
  createdAt: string
}

export interface OfferedTool {
  name: string
  description: string
}

export interface ConversationSummary {
  id: string
  title: string
  source: string
  createdAt: string
  updatedAt: string
}

export interface ToolCallRow {
  id: string
  toolUseId: string
  toolName: string
  input: unknown
  allowed: boolean
  resultCount: number | null
  resultSummary: string | null
  error: string | null
  durationMs: number
}

export interface TurnRow {
  id: string
  seq: number
  role: 'user' | 'assistant'
  content: Array<{ type: string; text?: string }>
  modelId: string | null
  promptVersionId: string | null
  stopReason: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  modelRounds: number
  latencyMs: number | null
  error: string | null
  createdAt: string
  toolCalls: ToolCallRow[]
}

export interface ConversationDetail extends ConversationSummary {
  turns: TurnRow[]
}

export interface EvalCase {
  id: string
  question: string
  askedAs: string
  outcome: 'answer' | 'refuse'
  expected: { answer: string; mustInclude: string[]; mustNotInclude: string[] }
  source: { screen: string; endpoint: string | null }
  notes?: string
}

export interface EvalCaseResult {
  id: string
  askedAs: string
  verdict: 'pass' | 'fail' | 'ungraded' | 'error'
  reasons: string[]
  answer: string
  toolsCalled: string[]
  toolsOffered: string[]
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  latencyMs: number
}

export interface EvalSummary {
  total: number
  graded: number
  passed: number
  passRate: number | null
  meanToolCalls: number
  meanInputTokens: number
  meanOutputTokens: number
  meanLatencyMs: number
}

const BASE = '/api/v1/assistant'

export const assistantKeys = {
  all: ['assistant'] as const,
  tools: () => [...assistantKeys.all, 'tools'] as const,
  prompts: () => [...assistantKeys.all, 'prompts'] as const,
  conversations: () => [...assistantKeys.all, 'conversations'] as const,
  conversation: (id: string) => [...assistantKeys.all, 'conversation', id] as const,
  evalCases: () => [...assistantKeys.all, 'eval-cases'] as const,
}

export const offeredToolsQueryOptions = queryOptions({
  queryKey: assistantKeys.tools(),
  queryFn: () => apiFetch<OfferedTool[]>(`${BASE}/tools`),
})

export const promptVersionsQueryOptions = queryOptions({
  queryKey: assistantKeys.prompts(),
  queryFn: () => apiFetch<PromptVersion[]>(`${BASE}/prompts`),
})

export const conversationsQueryOptions = queryOptions({
  queryKey: assistantKeys.conversations(),
  queryFn: () => apiFetch<ConversationSummary[]>(`${BASE}/conversations`),
})

export const conversationQueryOptions = (id: string) =>
  queryOptions({
    queryKey: assistantKeys.conversation(id),
    queryFn: () => apiFetch<ConversationDetail>(`${BASE}/conversations/${id}`),
    enabled: id !== '',
  })

export const evalCasesQueryOptions = queryOptions({
  queryKey: assistantKeys.evalCases(),
  queryFn: () => apiFetch<EvalCase[]>(`${BASE}/evals/cases`),
})

export function useSavePromptVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { systemPrompt: string; glossary: string; note?: string }) =>
      apiFetch<PromptVersion>(`${BASE}/prompts`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: assistantKeys.prompts() }),
  })
}

/** Publish a version — also how a rollback is done (publish an older one). */
export function usePublishPromptVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<PromptVersion>(`${BASE}/prompts/${id}/publish`, { method: 'POST', body: '{}' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: assistantKeys.prompts() }),
  })
}

const streamClient = createStreamClient({
  getBaseUrl: () => getConfig().assistantUrl,
  getToken: () => getSession()?.token ?? null,
})

export function streamChat(
  body: { question: string; conversationId?: string; promptVersionId?: string; effort?: Effort },
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  return streamClient.stream(`${BASE}/chat`, body, signal)
}

export function streamEvalRun(
  body: { promptVersionId?: string; caseIds?: string[]; effort?: Effort },
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  return streamClient.stream(`${BASE}/evals/run`, body, signal)
}
