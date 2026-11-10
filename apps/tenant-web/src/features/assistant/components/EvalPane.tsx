// Assistant Lab — Eval runner. Replays the ops eval set against the draft
// prompt AND the published one, then shows what the change fixed and what it
// broke. The single highest-value pane: it is what makes prompt iteration a
// measured loop.

import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  evalCasesQueryOptions,
  streamEvalRun,
  type Effort,
  type EvalCaseResult,
  type EvalSummary,
} from '@/api/assistant'
import { ApiError } from '@/api/client'
import { diffRuns, type CaseChange } from '../eval-diff'

interface Run {
  results: EvalCaseResult[]
  summary: EvalSummary | null
}

const CHANGE_VARIANT: Record<CaseChange, 'success' | 'destructive' | 'muted' | 'warning' | 'info'> =
  {
    fixed: 'success',
    regressed: 'destructive',
    'still-passing': 'muted',
    'still-failing': 'warning',
    ungraded: 'muted',
    new: 'info',
  }

function pct(s: EvalSummary | null): string {
  return s?.passRate == null ? '—' : `${(s.passRate * 100).toFixed(0)}% (${s.passed}/${s.graded})`
}

export function EvalPane({ draftId, effort }: { draftId: string | null; effort: Effort }) {
  const { data: cases = [] } = useQuery(evalCasesQueryOptions)
  const [draft, setDraft] = useState<Run | null>(null)
  const [published, setPublished] = useState<Run | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function runOne(
    label: string,
    promptVersionId: string | null,
    signal: AbortSignal,
  ): Promise<Run> {
    const run: Run = { results: [], summary: null }
    for await (const e of streamEvalRun(
      { effort, ...(promptVersionId ? { promptVersionId } : {}) },
      signal,
    )) {
      if (e.event === 'case') {
        run.results.push(e.data as EvalCaseResult)
        setProgress(`${label}: ${run.results.length}/${cases.length}`)
      } else if (e.event === 'summary') {
        run.summary = (e.data as { summary: EvalSummary }).summary
      }
    }
    return run
  }

  async function runAll() {
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setDraft(null)
    setPublished(null)
    try {
      setPublished(await runOne('Published', null, controller.signal))
      if (draftId) setDraft(await runOne('Draft', draftId, controller.signal))
    } catch (err) {
      setError(
        controller.signal.aborted
          ? 'Stopped.'
          : err instanceof ApiError
            ? err.message
            : 'The eval run failed.',
      )
    } finally {
      setProgress(null)
    }
  }

  const candidate = draft ?? published
  const diff = draft && published ? diffRuns(draft.results, published.results) : null
  const graded = cases.filter(
    (c) => c.expected.mustInclude.length + c.expected.mustNotInclude.length > 0,
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          {cases.length} case(s) in the eval set, {graded.length} graded.
        </span>
        {graded.length < cases.length && (
          <span className="text-xs text-yellow-700">
            Cases without mustInclude / mustNotInclude are reported as ungraded and never count as a
            pass.
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {progress ? (
            <Button variant="outline" onClick={() => abortRef.current?.abort()}>
              Stop ({progress})
            </Button>
          ) : (
            <Button onClick={() => void runAll()} disabled={cases.length === 0}>
              {draftId ? 'Run draft vs published' : 'Run published prompt'}
            </Button>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {published && (
        <div className="flex flex-wrap gap-6 text-sm">
          <div>
            Published: <span className="font-medium">{pct(published.summary)}</span>
          </div>
          {draft && (
            <div>
              Draft: <span className="font-medium">{pct(draft.summary)}</span>
            </div>
          )}
          {diff && (
            <div>
              <Badge variant="success">{diff.fixed} fixed</Badge>{' '}
              <Badge variant="destructive">{diff.regressed} regressed</Badge>
            </div>
          )}
          {candidate?.summary && (
            <div className="text-muted-foreground">
              mean {candidate.summary.meanToolCalls.toFixed(1)} tool calls,{' '}
              {Math.round(candidate.summary.meanInputTokens)} in /{' '}
              {Math.round(candidate.summary.meanOutputTokens)} out tokens,{' '}
              {(candidate.summary.meanLatencyMs / 1000).toFixed(1)}s per question
            </div>
          )}
        </div>
      )}

      {candidate && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Case</th>
                <th className="py-1 pr-3">As</th>
                <th className="py-1 pr-3">Result</th>
                <th className="py-1 pr-3">Tools</th>
                <th className="py-1 pr-3">Answer</th>
              </tr>
            </thead>
            <tbody>
              {candidate.results.map((r) => {
                const change = diff?.cases.find((c) => c.id === r.id)?.change
                return (
                  <tr key={r.id} className="border-t align-top">
                    <td className="py-1 pr-3 font-mono">{r.id}</td>
                    <td className="py-1 pr-3">{r.askedAs}</td>
                    <td className="py-1 pr-3">
                      <Badge
                        variant={
                          r.verdict === 'pass'
                            ? 'success'
                            : r.verdict === 'ungraded'
                              ? 'muted'
                              : 'destructive'
                        }
                      >
                        {r.verdict}
                      </Badge>
                      {change && (
                        <Badge variant={CHANGE_VARIANT[change]} className="ml-1">
                          {change}
                        </Badge>
                      )}
                      {r.reasons.map((reason) => (
                        <p key={reason} className="text-muted-foreground">
                          {reason}
                        </p>
                      ))}
                    </td>
                    <td className="py-1 pr-3 font-mono">{r.toolsCalled.join(', ') || '—'}</td>
                    <td className="max-w-md py-1 pr-3">
                      <details>
                        <summary className="cursor-pointer truncate">
                          {r.answer.slice(0, 80) || '(empty)'}
                        </summary>
                        <p className="mt-1 whitespace-pre-wrap">{r.answer}</p>
                      </details>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
