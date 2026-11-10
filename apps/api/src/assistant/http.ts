// ---------------------------------------------------------------------------
// Assistant HTTP surface — mounted at /api/v1/assistant on the v1 router, so it
// inherits tenantMiddleware (Cognito ID token → tenant, principal, scoped db)
// and Cedar exactly like every other v1 route. Nothing about auth is forked.
//
// The same app is served two ways:
//   - by the main API Lambda behind API Gateway (buffered, 29 s cap) — fine for
//     the CRUD routes;
//   - by the streaming assistant Lambda behind a Function URL (lambda-assistant.ts,
//     RESPONSE_STREAM, minutes not seconds) — what /chat and /evals/run need.
//
// Kill switch: every route answers 404 ASSISTANT_DISABLED unless
// ASSISTANT_ENABLED=true. The flag is set by CDK (packages/infra), so turning
// the assistant off is a deploy-time lever, not a code change.
// ---------------------------------------------------------------------------

import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import type { AppEnv } from '../types'
import { Actions } from '../authz/actions'
import { requirePermission } from '../middleware/rbac'
import { authorize } from '../lib/authz'
import { logger } from '../lib/logger'
import { assistantEnabled } from '../lib/assistant-feature'
import { resolveInferenceProvider } from '../lib/inference/provider'
import {
  createConversation,
  createPromptVersion,
  findConversationForUser,
  findPromptVersion,
  findPublishedPrompt,
  listConversationsForUser,
  listPromptVersions,
  publishPromptVersion,
  recordExchange,
  type ConversationSource,
  type PromptVersionRow,
} from '../repositories/assistant.repository'
import { historyFromTurns, runTurn, type AssistantEvent } from './loop'
import { DEFAULT_PROMPT, type PromptSource } from './prompt'
import { offeredTools } from './tools/registry'
import type { ToolContext } from './tools/types'
import { parseEvalSet, type AssistantEvalCase } from './evals/schema'
import { runEvalCase, summarize, type CaseResult } from './evals/runner'
import opsBaseline from './evals/ops-baseline.json'

/** How the router reaches the rest of the API in-process (injected: no import cycle). */
export type InProcessFetch = (req: Request) => Response | Promise<Response>

/** Prior turns replayed as history (bounded — a long thread must not grow cost forever). */
const HISTORY_TURNS = 20

const Effort = z.enum(['low', 'medium', 'high'])

const ChatBody = z
  .object({
    question: z.string().trim().min(1).max(4_000),
    conversationId: z.string().uuid().optional(),
    /** Lab only (ManageAssistantPrompt): run a draft instead of the published prompt. */
    promptVersionId: z.string().uuid().optional(),
    effort: Effort.optional(),
  })
  .strict()

const PromptBody = z
  .object({
    systemPrompt: z.string().trim().min(1).max(20_000),
    glossary: z.string().max(20_000).default(''),
    note: z.string().max(500).optional(),
  })
  .strict()

const EvalBody = z
  .object({
    promptVersionId: z.string().uuid().optional(),
    caseIds: z.array(z.string()).optional(),
    effort: Effort.optional(),
  })
  .strict()

function toPromptSource(row: PromptVersionRow | null): PromptSource {
  return row
    ? { versionId: row.id, systemPrompt: row.systemPrompt, glossary: row.glossary }
    : DEFAULT_PROMPT
}

/** Headers forwarded on in-process tool calls so they authenticate as the caller. */
const FORWARDED_HEADERS = ['authorization', 'x-tenant-slug', 'x-correlation-id'] as const

function toolContext(c: Context<AppEnv>, fetchApp: InProcessFetch): ToolContext {
  const headers = new Headers()
  for (const h of FORWARDED_HEADERS) {
    const v = c.req.header(h)
    if (v) headers.set(h, v)
  }
  const correlationId = c.get('correlationId')
  if (correlationId) headers.set('x-correlation-id', correlationId)
  return {
    principal: c.get('principal'),
    idToken: c.get('idToken') ?? '',
    policyStoreId: c.get('policyStoreId'),
    fetchApi: async (path) =>
      fetchApp(new Request(new URL(path, 'http://assistant.internal'), { headers })),
  }
}

async function bodyOf<S extends z.ZodType>(
  c: Context<AppEnv>,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; res: Response }> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    raw = undefined
  }
  const r = schema.safeParse(raw)
  if (!r.success) {
    return {
      ok: false,
      res: c.json({ error: z.prettifyError(r.error), code: 'VALIDATION_ERROR' }, 400),
    }
  }
  return { ok: true, data: r.data }
}

async function canManagePrompt(c: Context<AppEnv>): Promise<boolean> {
  const d = await authorize({
    principal: c.get('principal'),
    action: Actions.ManageAssistantPrompt,
    idToken: c.get('idToken'),
    policyStoreId: c.get('policyStoreId'),
  })
  return d.allowed
}

export function createAssistantRouter(fetchApp: InProcessFetch): Hono<AppEnv> {
  const r = new Hono<AppEnv>()

  r.use('*', async (c, next) => {
    if (!assistantEnabled()) {
      return c.json({ error: 'The assistant is not enabled', code: 'ASSISTANT_DISABLED' }, 404)
    }
    if (!c.get('userId')) {
      return c.json({ error: 'No user record for this login', code: 'FORBIDDEN' }, 403)
    }
    await next()
  })

  // ── What the model would be offered for this user ─────────────────────────
  r.get('/tools', requirePermission(Actions.UseAssistant), async (c) => {
    const tools = await offeredTools(toolContext(c, fetchApp))
    return c.json({ data: tools.map((t) => ({ name: t.name, description: t.description })) })
  })

  // ── Conversations + traces ────────────────────────────────────────────────
  r.get('/conversations', requirePermission(Actions.UseAssistant), async (c) => {
    const data = await listConversationsForUser(c.get('db'), c.get('tenantId'), c.get('userId')!)
    return c.json({ data })
  })

  r.get('/conversations/:id', requirePermission(Actions.UseAssistant), async (c) => {
    const data = await findConversationForUser(
      c.get('db'),
      c.get('tenantId'),
      c.req.param('id') ?? '',
      c.get('userId')!,
    )
    if (!data) return c.json({ error: 'Conversation not found', code: 'NOT_FOUND' }, 404)
    return c.json({ data })
  })

  // ── Chat (streamed) ───────────────────────────────────────────────────────
  r.post('/chat', requirePermission(Actions.UseAssistant), async (c) => {
    const parsed = await bodyOf(c, ChatBody)
    if (!parsed.ok) return parsed.res
    const body = parsed.data
    const db = c.get('db')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')!

    // A draft prompt is a Lab feature: it needs the authoring action.
    let prompt: PromptSource
    let source: ConversationSource = 'chat'
    if (body.promptVersionId) {
      if (!(await canManagePrompt(c))) {
        return c.json(
          { error: 'Forbidden: insufficient permissions for this action', code: 'FORBIDDEN' },
          403,
        )
      }
      const row = await findPromptVersion(db, tenantId, body.promptVersionId)
      if (!row) return c.json({ error: 'Prompt version not found', code: 'NOT_FOUND' }, 404)
      prompt = toPromptSource(row)
      source = 'lab'
    } else {
      prompt = toPromptSource(await findPublishedPrompt(db, tenantId))
    }

    let conversationId = body.conversationId
    let history: ReturnType<typeof historyFromTurns> = []
    if (conversationId) {
      const conv = await findConversationForUser(db, tenantId, conversationId, userId)
      if (!conv) return c.json({ error: 'Conversation not found', code: 'NOT_FOUND' }, 404)
      history = historyFromTurns(conv.turns.slice(-HISTORY_TURNS))
    } else {
      conversationId = (
        await createConversation(db, { tenantId, userId, title: body.question, source })
      ).id
    }

    const tool = toolContext(c, fetchApp)
    const provider = resolveInferenceProvider()
    const convId = conversationId

    return streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) =>
        stream.writeSSE({ event, data: JSON.stringify(data) })
      await send('conversation', { conversationId: convId, promptVersionId: prompt.versionId })
      const turn = await runTurn({
        provider,
        tool,
        prompt,
        history,
        question: body.question,
        now: new Date(),
        ...(body.effort ? { effort: body.effort } : {}),
        onEvent: (e: AssistantEvent) => {
          void send(e.type, e)
        },
      })
      let turnId: string | null = null
      try {
        turnId = await recordExchange(db, {
          tenantId,
          conversationId: convId,
          userContent: turn.userContent,
          assistantText: turn.text,
          modelId: turn.modelId,
          promptVersionId: prompt.versionId,
          stopReason: turn.stopReason,
          inputTokens: turn.usage.inputTokens,
          outputTokens: turn.usage.outputTokens,
          cacheReadTokens: turn.usage.cacheReadTokens,
          cacheWriteTokens: turn.usage.cacheWriteTokens,
          modelRounds: turn.rounds,
          latencyMs: turn.latencyMs,
          error: turn.error,
          toolCalls: turn.toolCalls,
        })
      } catch (err) {
        logger.error('assistant: failed to record exchange', {
          error: String(err),
          conversationId: convId,
        })
      }
      if (turn.error) {
        logger.error('assistant: turn failed', { error: turn.error, conversationId: convId })
        await send('error', { message: 'The assistant could not answer. Please try again.' })
      }
      await send('done', {
        conversationId: convId,
        turnId,
        text: turn.text,
        usage: turn.usage,
        rounds: turn.rounds,
        latencyMs: turn.latencyMs,
        modelId: turn.modelId,
      })
    })
  })

  // ── Prompt store (Assistant Lab) ──────────────────────────────────────────
  r.get('/prompts', requirePermission(Actions.ManageAssistantPrompt), async (c) => {
    return c.json({ data: await listPromptVersions(c.get('db'), c.get('tenantId')) })
  })

  r.get('/prompts/published', requirePermission(Actions.UseAssistant), async (c) => {
    const row = await findPublishedPrompt(c.get('db'), c.get('tenantId'))
    return c.json({ data: row, default: row ? null : DEFAULT_PROMPT })
  })

  r.post('/prompts', requirePermission(Actions.ManageAssistantPrompt), async (c) => {
    const parsed = await bodyOf(c, PromptBody)
    if (!parsed.ok) return parsed.res
    const data = await createPromptVersion(c.get('db'), {
      tenantId: c.get('tenantId'),
      systemPrompt: parsed.data.systemPrompt,
      glossary: parsed.data.glossary,
      note: parsed.data.note,
      authorUserId: c.get('userId')!,
    })
    return c.json({ data }, 201)
  })

  // Publish — and rollback, which is publishing an older version.
  r.post('/prompts/:id/publish', requirePermission(Actions.ManageAssistantPrompt), async (c) => {
    const data = await publishPromptVersion(c.get('db'), {
      tenantId: c.get('tenantId'),
      id: c.req.param('id') ?? '',
      publishedBy: c.get('userId')!,
    })
    if (!data) return c.json({ error: 'Prompt version not found', code: 'NOT_FOUND' }, 404)
    return c.json({ data })
  })

  // ── Evals (Assistant Lab) ─────────────────────────────────────────────────
  r.get('/evals/cases', requirePermission(Actions.ManageAssistantPrompt), (c) => {
    return c.json({ data: parseEvalSet(opsBaseline).cases })
  })

  /**
   * Replays the eval set against a prompt (a draft, or the published one) and
   * streams one `case` event per case, then a `summary`. The Lab diffs two runs
   * (draft vs published) to show what a prompt change moved.
   */
  r.post('/evals/run', requirePermission(Actions.ManageAssistantPrompt), async (c) => {
    const parsed = await bodyOf(c, EvalBody)
    if (!parsed.ok) return parsed.res
    const body = parsed.data
    const db = c.get('db')
    const tenantId = c.get('tenantId')

    let prompt: PromptSource
    if (body.promptVersionId) {
      const row = await findPromptVersion(db, tenantId, body.promptVersionId)
      if (!row) return c.json({ error: 'Prompt version not found', code: 'NOT_FOUND' }, 404)
      prompt = toPromptSource(row)
    } else {
      prompt = toPromptSource(await findPublishedPrompt(db, tenantId))
    }

    let cases: AssistantEvalCase[] = parseEvalSet(opsBaseline).cases
    if (body.caseIds?.length) {
      const wanted = new Set(body.caseIds)
      cases = cases.filter((x) => wanted.has(x.id))
    }

    const tool = toolContext(c, fetchApp)
    const provider = resolveInferenceProvider()

    return streamSSE(c, async (stream) => {
      const results: CaseResult[] = []
      await stream.writeSSE({
        event: 'start',
        data: JSON.stringify({
          total: cases.length,
          promptVersionId: prompt.versionId,
          modelId: provider.modelId,
        }),
      })
      for (const evalCase of cases) {
        const result = await runEvalCase({
          evalCase,
          provider,
          prompt,
          caller: tool.principal,
          idToken: tool.idToken,
          policyStoreId: tool.policyStoreId,
          fetchApi: tool.fetchApi,
          now: new Date(),
          ...(body.effort ? { effort: body.effort } : {}),
        })
        results.push(result)
        await stream.writeSSE({ event: 'case', data: JSON.stringify(result) })
      }
      await stream.writeSSE({
        event: 'summary',
        data: JSON.stringify({ promptVersionId: prompt.versionId, summary: summarize(results) }),
      })
    })
  })

  return r
}
