// Assistant Lab — Eval runner. Replays the ops eval set against the draft
// prompt AND the published one, then shows what the change fixed and what it
// broke. The single highest-value pane: it is what makes prompt iteration a
// measured loop.
//
// It also picks the model (any in ASSISTANT_ALLOWED_MODELS; chat always uses
// the default) and keeps every finished run's summary in a per-model table, so
// models can be compared side by side (plans/*/assistant-converse.md D8).

import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  assistantModelsQueryOptions,
  evalCasesQueryOptions,
  streamEvalRun,
  type Effort,
  type EvalCaseResult,
  type EvalSummary,
} from '@/api/assistant'
import { ApiError } from '@/api/client'
import { diffRuns, type CaseChange } from '../eval-diff'

interface Run {
  /** The model that answered, as the server reported it. */
  modelId: string | null
  results: EvalCaseResult[]
  summary: EvalSummary | null
}

/** One finished run in the comparison table. */
interface Compared {
  modelId: string
  prompt: string
  effort: Effort
  summary: EvalSummary
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
  const { data: models } = useQuery(assistantModelsQueryOptions)
  const [picked, setPicked] = useState<string | null>(null)
  const model = picked ?? models?.default ?? null
  const [draft, setDraft] = useState<Run | null>(null)
  const [published, setPublished] = useState<Run | null>(null)
  const [compared, setCompared] = useState<Compared[]>([])
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function runOne(
    label: string,
    promptVersionId: string | null,
    modelId: string | null,
    signal: AbortSignal,
  ): Promise<Run> {
    const run: Run = { modelId, results: [], summary: null }
    for await (const e of streamEvalRun(
      {
        effort,
        ...(promptVersionId ? { promptVersionId } : {}),
        ...(modelId ? { modelId } : {}),
      },
      signal,
    )) {
      if (e.event === 'start') {
        run.modelId = (e.data as { modelId?: string }).modelId ?? modelId
      } else if (e.event === 'case') {
        run.results.push(e.data as EvalCaseResult)
        setProgress(`${label}: ${run.results.length}/${cases.length}`)
      } else if (e.event === 'summary') {
        run.summary = (e.data as { summary: EvalSummary }).summary
      }
    }
    const summary = run.summary
    if (summary) {
      setCompared((prev) => [
        ...prev,
        {
          modelId: run.modelId ?? '(default)',
          prompt: promptVersionId ? 'Draft' : 'Published',
          effort,
          summary,
        },
      ])
    }
    return run
  }

  async function guarded(work: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    try {
      await work(controller.signal)
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

  /** The current prompt (the draft if there is one) on every allowed model, one after another. */
  function runEveryModel() {
    const label = draftId ? 'Draft' : 'Published'
    return guarded(async (signal) => {
      for (const m of models?.allowed ?? []) {
        await runOne(`${label} on ${m}`, draftId, m, signal)
      }
    })
  }

  async function runAll() {
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setDraft(null)
    setPublished(null)
    try {
      setPublished(await runOne('Published', null, model, controller.signal))
      if (draftId) setDraft(await runOne('Draft', draftId, model, controller.signal))
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
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {models && models.allowed.length > 1 && (
            <label className="flex items-center gap-1 text-xs">
              Model
              <select
                className="rounded border bg-background px-2 py-1 text-xs"
                value={model ?? ''}
                disabled={progress !== null}
                onChange={(e) => setPicked(e.target.value)}
              >
                {models.allowed.map((m) => (
                  <option key={m} value={m}>
                    {m}
                    {m === models.default ? ' (chat default)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {progress ? (
            <Button variant="outline" onClick={() => abortRef.current?.abort()}>
              Stop ({progress})
            </Button>
          ) : (
            <>
              <Button onClick={() => void runAll()} disabled={cases.length === 0}>
                {draftId ? 'Run draft vs published' : 'Run published prompt'}
              </Button>
              {models && models.allowed.length > 1 && (
                <Button
                  variant="outline"
                  onClick={() => void runEveryModel()}
                  disabled={cases.length === 0}
                >
                  Run on every model
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {compared.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Model</th>
                <th className="py-1 pr-3">Prompt</th>
                <th className="py-1 pr-3">Effort</th>
                <th className="py-1 pr-3">Pass rate</th>
                <th className="py-1 pr-3">Tool calls</th>
                <th className="py-1 pr-3">Rounds</th>
                <th className="py-1 pr-3">Tokens in / out / cache read</th>
                <th className="py-1 pr-3">Latency</th>
              </tr>
            </thead>
            <tbody>
              {compared.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="py-1 pr-3 font-mono">{r.modelId}</td>
                  <td className="py-1 pr-3">{r.prompt}</td>
                  <td className="py-1 pr-3">{r.effort}</td>
                  <td className="py-1 pr-3">{pct(r.summary)}</td>
                  <td className="py-1 pr-3">{r.summary.meanToolCalls.toFixed(1)}</td>
                  <td className="py-1 pr-3">{r.summary.meanRounds.toFixed(1)}</td>
                  <td className="py-1 pr-3">
                    {Math.round(r.summary.meanInputTokens)} /{' '}
                    {Math.round(r.summary.meanOutputTokens)} /{' '}
                    {Math.round(r.summary.meanCacheReadTokens)}
                  </td>
                  <td className="py-1 pr-3">{(r.summary.meanLatencyMs / 1000).toFixed(1)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-muted-foreground">
            Means per question. Cost: multiply the tokens by each model&apos;s Bedrock price.{' '}
            <button className="underline" onClick={() => setCompared([])}>
              Clear
            </button>
          </p>
        </div>
      )}

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
