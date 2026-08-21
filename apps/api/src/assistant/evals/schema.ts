// ---------------------------------------------------------------------------
// AI Chat Assistant — eval-set schema.
//
// The eval set is Phase 0's deliverable and the acceptance gate for every later
// phase (see plans/in-progress/assistant-phase0.md). It is authored by the
// operations administrator, not by engineering: each case is a question a real
// ops user would type, the answer that is actually correct, and where a human
// reads that answer today.
//
// Parsed with zod rather than hand-checked so that a malformed case fails in CI
// (schema.test.ts) instead of silently scoring as a miss when Phase 1's runner
// replays the file. Adding a field is a code change here, never a migration.
// ---------------------------------------------------------------------------

import { z } from 'zod'

/**
 * Role names must match `apps/api/src/authz/role-options.ts` exactly — the
 * runner grants the case's role to a test principal, so a typo would silently
 * evaluate the wrong tool list. Kept as a literal union, not a free string, so
 * a rename breaks the build here rather than at replay time.
 *
 * Service-account personas (`reporting`, `integrations`, `workflow_*`) are
 * deliberately absent: the assistant always runs as a human principal.
 */
const EvalRole = z.enum([
  'tenant_admin',
  'billing_manager',
  'accountant',
  'operations_admin',
  'senior_management',
  'coordinator',
  'customer_service_manager',
  'local_dispatch',
  'long_distance_dispatch',
  'central_planning_dispatch',
  'warehouse',
  'sales',
  'driver',
  'viewer',
])

/**
 * `refuse` cases are the security half of the eval set and must not be treated
 * as filler. The correct behavior for "a driver asks a billing question" is a
 * graceful "I don't have access to that" — produced because the tool was never
 * offered, not because the model chose to decline. A `refuse` case passes only
 * when no privileged data appears in the answer, which is why `mustNotInclude`
 * carries the real assertion there.
 */
const Outcome = z.enum(['answer', 'refuse'])

const EvalSource = z.object({
  /**
   * The screen an ops user reads this off today. Always required — it is the
   * provenance of the expected answer even when no endpoint serves it.
   */
  screen: z.string().min(1),
  /**
   * The API path that serves it, or null when nothing does yet.
   *
   * Null is a legitimate, expected value: the longhaul planning surface
   * (`/api/v1/onprem/longhaul/*`) is Cognito-session-only, so an author
   * exploring with a `vnd_` key cannot reach it — see the onboarding doc at
   * docs/ai-assistant-ops-admin-onboarding.md. Phase 1 tools execute as the
   * caller's own Cognito principal, which closes that gap.
   */
  endpoint: z.string().min(1).nullable(),
})

const EvalExpectation = z.object({
  /** The correct answer in prose — what a knowledgeable colleague would say. */
  answer: z.string().min(1),
  /** Substrings that MUST appear: figures, names, statuses. The graded part. */
  mustInclude: z.array(z.string().min(1)).default([]),
  /** Substrings that must NEVER appear. Carries the assertion on `refuse` cases. */
  mustNotInclude: z.array(z.string().min(1)).default([]),
})

const AssistantEvalCaseSchema = z.object({
  /** Stable kebab-case id. Never reuse one — pass-rate trends are keyed on it. */
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id must be kebab-case'),
  /** Verbatim, as a user would type it — including the sloppy phrasing. */
  question: z.string().min(1),
  /** The role the question is asked as. Role scoping is the feature. */
  askedAs: EvalRole,
  outcome: Outcome,
  expected: EvalExpectation,
  source: EvalSource,
  notes: z.string().optional(),
})

const AssistantEvalSetSchema = z
  .object({
    version: z.literal(1),
    cases: z.array(AssistantEvalCaseSchema),
  })
  .superRefine((set, ctx) => {
    const seen = new Set<string>()
    for (const [index, evalCase] of set.cases.entries()) {
      if (seen.has(evalCase.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['cases', index, 'id'],
          message: `duplicate case id "${evalCase.id}" — ids key the pass-rate trend and must be unique`,
        })
      }
      seen.add(evalCase.id)

      // A `refuse` case with nothing forbidden asserts nothing: any answer at
      // all would pass it, including one that leaked the very data the case
      // exists to keep out.
      if (evalCase.outcome === 'refuse' && evalCase.expected.mustNotInclude.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['cases', index, 'expected', 'mustNotInclude'],
          message: 'a refuse case must list what the answer may never contain',
        })
      }
    }
  })

export type AssistantEvalCase = z.infer<typeof AssistantEvalCaseSchema>
export type AssistantEvalSet = z.infer<typeof AssistantEvalSetSchema>

/** Parses an eval set, throwing a zod error naming the offending case path. */
export function parseEvalSet(raw: unknown): AssistantEvalSet {
  return AssistantEvalSetSchema.parse(raw)
}
