// Assistant Lab — Trace viewer. Per answer: which tools were called with what
// arguments, what came back, how long, how many tokens. Reads the persisted
// AssistantTurn / AssistantToolCall rows — the same rows that are the audit log.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { conversationQueryOptions, conversationsQueryOptions, type TurnRow } from '@/api/assistant'

function TurnTrace({ turn }: { turn: TurnRow }) {
  const text = turn.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
  if (turn.role === 'user') {
    // The first block is the injected date context; show the question itself.
    const question = turn.content.at(-1)?.text ?? text
    return <p className="text-sm font-medium">Q: {question}</p>
  }
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>model {turn.modelId ?? '—'}</span>
        <span>prompt {turn.promptVersionId ? turn.promptVersionId.slice(0, 8) : 'default'}</span>
        <span>{turn.modelRounds} round(s)</span>
        <span>
          {turn.inputTokens} in / {turn.outputTokens} out / {turn.cacheReadTokens} cached
        </span>
        {turn.latencyMs !== null && <span>{(turn.latencyMs / 1000).toFixed(1)}s</span>}
        {turn.stopReason && <span>stop: {turn.stopReason}</span>}
      </div>
      {turn.error && <p className="text-xs text-destructive">Error: {turn.error}</p>}
      {turn.toolCalls.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Tool</th>
                <th className="py-1 pr-3">Arguments</th>
                <th className="py-1 pr-3">Result</th>
                <th className="py-1 pr-3">Time</th>
              </tr>
            </thead>
            <tbody>
              {turn.toolCalls.map((t) => (
                <tr key={t.id} className="border-t align-top">
                  <td className="py-1 pr-3 font-mono">
                    {t.toolName}
                    {!t.allowed && (
                      <Badge variant="destructive" className="ml-1">
                        denied
                      </Badge>
                    )}
                  </td>
                  <td className="py-1 pr-3 font-mono">{JSON.stringify(t.input)}</td>
                  <td className="py-1 pr-3">
                    {t.error ? (
                      <span className="text-destructive">{t.error}</span>
                    ) : (
                      <details>
                        <summary className="cursor-pointer">
                          {t.resultCount !== null ? `${t.resultCount} rows` : 'result'}
                        </summary>
                        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono">
                          {t.resultSummary}
                        </pre>
                      </details>
                    )}
                  </td>
                  <td className="py-1 pr-3">{(t.durationMs / 1000).toFixed(2)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="whitespace-pre-wrap text-sm">{text}</p>
    </div>
  )
}

export function TracePane() {
  const { data: conversations = [], isLoading } = useQuery(conversationsQueryOptions)
  const [selected, setSelected] = useState<string>('')
  const { data: detail } = useQuery(conversationQueryOptions(selected))

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_3fr]">
      <ul className="space-y-1 text-sm">
        {isLoading && <li className="text-muted-foreground">Loading…</li>}
        {!isLoading && conversations.length === 0 && (
          <li className="text-muted-foreground">No conversations yet.</li>
        )}
        {conversations.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => setSelected(c.id)}
              className={`w-full rounded-md px-2 py-1 text-left hover:bg-muted ${selected === c.id ? 'bg-muted font-medium' : ''}`}
            >
              <span className="block truncate">{c.title}</span>
              <span className="text-xs text-muted-foreground">
                {c.source} · {new Date(c.updatedAt).toLocaleString()}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="space-y-3">
        {!selected && (
          <p className="text-sm text-muted-foreground">Pick a conversation to see its trace.</p>
        )}
        {detail?.turns.map((t) => (
          <TurnTrace key={t.id} turn={t} />
        ))}
      </div>
    </div>
  )
}
