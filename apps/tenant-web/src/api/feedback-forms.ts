import { apiFetch } from './client'

// ---------------------------------------------------------------------------
// Feedback forms — mirror apps/api/src/handlers/feedback-forms.ts (authenticated
// read-only viewer) and handlers/feedback-public.ts (the public respond page).
//
// A tenant authors versioned survey forms via the SDK/CLI; this app only READS
// them (list + versions) for the settings viewer. The public form page fetches
// and submits against the pre-tenant /api/public/v1 surface (no auth needed —
// the capability token in the path resolves the tenant).
// ---------------------------------------------------------------------------

export type FeedbackQuestionType = 'rating' | 'number' | 'text' | 'select' | 'boolean'

/** One authored question, as returned in a form definition. */
export interface FeedbackQuestion {
  id: string
  type: FeedbackQuestionType
  label: string
  required?: boolean
  min?: number
  max?: number
  maxLength?: number
  options?: string[]
}

export interface FeedbackFormDefinition {
  questions: FeedbackQuestion[]
}

/** Compact projection for the viewer list / version history. */
export interface FeedbackFormSummary {
  id: string
  formKey: string
  version: number
  status: 'PUBLISHED' | 'SUPERSEDED'
  title: string
  publishedBy: string
  createdAt: string
}

/** Full projection including the editable definition. */
export interface FeedbackFormFull extends FeedbackFormSummary {
  definition: FeedbackFormDefinition
  messageTemplate: string | null
}

/** Public (respondent-facing) form view — no subject PII. */
export interface PublicFeedbackForm {
  status: 'pending' | 'submitted' | 'expired'
  title: string
  definition: FeedbackFormDefinition
}

// ── authenticated viewer reads (ReadFeedbackForms) ──────────────────────────

/** List the tenant's active (latest published) forms. */
export async function listFeedbackForms(): Promise<FeedbackFormSummary[]> {
  return apiFetch<FeedbackFormSummary[]>('/api/v1/feedback-forms')
}

/** The active form for a key (full projection). */
export async function getFeedbackForm(formKey: string): Promise<FeedbackFormFull> {
  return apiFetch<FeedbackFormFull>(`/api/v1/feedback-forms/${encodeURIComponent(formKey)}`)
}

/** Version history for a key, newest first. */
export async function listFeedbackFormVersions(formKey: string): Promise<FeedbackFormSummary[]> {
  return apiFetch<FeedbackFormSummary[]>(
    `/api/v1/feedback-forms/${encodeURIComponent(formKey)}/versions`,
  )
}

// ── public respondent surface (no auth — token in path) ─────────────────────

/** Fetch the form to render for a capability token. */
export async function getPublicFeedbackForm(token: string): Promise<PublicFeedbackForm> {
  return apiFetch<PublicFeedbackForm>(`/api/public/v1/feedback/${encodeURIComponent(token)}`)
}

/** Submit a response for a capability token. */
export async function submitPublicFeedback(
  token: string,
  response: Record<string, unknown>,
): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/api/public/v1/feedback/${encodeURIComponent(token)}`, {
    method: 'POST',
    body: JSON.stringify({ response }),
  })
}
