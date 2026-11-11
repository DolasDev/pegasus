// Diff two eval runs (a draft prompt vs the published one) case by case. This is
// what turns prompt editing into a measured loop: the Lab shows which cases a
// change fixed and which it broke, not just a new pass rate.

import type { EvalCaseResult } from '@/api/assistant'

export type CaseChange =
  'fixed' | 'regressed' | 'still-passing' | 'still-failing' | 'ungraded' | 'new'

export interface CaseDiff {
  id: string
  change: CaseChange
  draft: EvalCaseResult
  baseline: EvalCaseResult | null
}

const passed = (r: EvalCaseResult) => r.verdict === 'pass'
const graded = (r: EvalCaseResult) => r.verdict !== 'ungraded'

export function diffRuns(
  draft: readonly EvalCaseResult[],
  baseline: readonly EvalCaseResult[],
): { cases: CaseDiff[]; fixed: number; regressed: number } {
  const base = new Map(baseline.map((r) => [r.id, r]))
  const cases = draft.map((d): CaseDiff => {
    const b = base.get(d.id) ?? null
    let change: CaseChange
    if (!graded(d)) change = 'ungraded'
    else if (!b || !graded(b)) change = 'new'
    else if (passed(d) && !passed(b)) change = 'fixed'
    else if (!passed(d) && passed(b)) change = 'regressed'
    else change = passed(d) ? 'still-passing' : 'still-failing'
    return { id: d.id, change, draft: d, baseline: b }
  })
  return {
    cases,
    fixed: cases.filter((c) => c.change === 'fixed').length,
    regressed: cases.filter((c) => c.change === 'regressed').length,
  }
}
