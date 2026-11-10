// ---------------------------------------------------------------------------
// AI assistant persistence: the ops-owned prompt store and the conversation /
// turn / tool-call traces. Plan: plans/in-progress/ai-chat-assistant.md (1d).
//
// All four models are in TENANT_SCOPED_MODELS, so the request's scoped client
// already confines every read and write to the caller's tenant. Every query
// here ALSO names tenantId explicitly: under SKIP_AUTH (local dev, the e2e
// stack) `db` is the unscoped base client, and the explicit predicate keeps
// those environments honest too. Creates always set tenantId.
// ---------------------------------------------------------------------------

import { Prisma, type PrismaClient } from '@prisma/client'

// ── Prompt versions ─────────────────────────────────────────────────────────

export type PromptVersionRow = Prisma.AssistantPromptVersionGetPayload<object>

export function listPromptVersions(
  db: PrismaClient,
  tenantId: string,
): Promise<PromptVersionRow[]> {
  return db.assistantPromptVersion.findMany({
    where: { tenantId },
    orderBy: { version: 'desc' },
    take: 100,
  })
}

export function findPromptVersion(
  db: PrismaClient,
  tenantId: string,
  id: string,
): Promise<PromptVersionRow | null> {
  return db.assistantPromptVersion.findFirst({ where: { tenantId, id } })
}

export function findPublishedPrompt(
  db: PrismaClient,
  tenantId: string,
): Promise<PromptVersionRow | null> {
  return db.assistantPromptVersion.findFirst({
    where: { tenantId, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
  })
}

/**
 * Save a new immutable DRAFT version. The version number is max + 1; a
 * concurrent save that takes the same number trips the (tenantId, version)
 * unique index and is retried once.
 */
export async function createPromptVersion(
  db: PrismaClient,
  input: {
    tenantId: string
    systemPrompt: string
    glossary: string
    note?: string | undefined
    authorUserId: string
  },
): Promise<PromptVersionRow> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const agg = await tx.assistantPromptVersion.aggregate({
          where: { tenantId: input.tenantId },
          _max: { version: true },
        })
        return tx.assistantPromptVersion.create({
          data: {
            tenantId: input.tenantId,
            version: (agg._max.version ?? 0) + 1,
            status: 'DRAFT',
            systemPrompt: input.systemPrompt,
            glossary: input.glossary,
            note: input.note ?? null,
            authorUserId: input.authorUserId,
          },
        })
      })
    } catch (err) {
      const conflict = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
      if (!conflict || attempt >= 1) throw err
    }
  }
}

/**
 * Publish a version: the current PUBLISHED one (if any) becomes SUPERSEDED and
 * this one becomes PUBLISHED, in one transaction. Rolling back is publishing an
 * older version. Returns null when the id is not this tenant's.
 */
export async function publishPromptVersion(
  db: PrismaClient,
  input: { tenantId: string; id: string; publishedBy: string },
): Promise<PromptVersionRow | null> {
  const { tenantId } = input
  return db.$transaction(async (tx) => {
    const target = await tx.assistantPromptVersion.findFirst({ where: { tenantId, id: input.id } })
    if (!target) return null
    await tx.assistantPromptVersion.updateMany({
      where: { tenantId, status: 'PUBLISHED', NOT: { id: target.id } },
      data: { status: 'SUPERSEDED' },
    })
    await tx.assistantPromptVersion.updateMany({
      where: { tenantId, id: target.id },
      data: { status: 'PUBLISHED', publishedBy: input.publishedBy, publishedAt: new Date() },
    })
    return tx.assistantPromptVersion.findFirst({ where: { tenantId, id: target.id } })
  })
}

// ── Conversations and traces ────────────────────────────────────────────────

export type ConversationSource = 'chat' | 'lab' | 'eval'

export function createConversation(
  db: PrismaClient,
  input: { tenantId: string; userId: string; title: string; source: ConversationSource },
) {
  return db.assistantConversation.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId,
      title: input.title.slice(0, 120),
      source: input.source,
    },
  })
}

/** A conversation with its turns and tool calls — only if it is this user's. */
export function findConversationForUser(
  db: PrismaClient,
  tenantId: string,
  id: string,
  userId: string,
) {
  return db.assistantConversation.findFirst({
    where: { tenantId, id, userId },
    include: {
      turns: {
        orderBy: { seq: 'asc' },
        include: { toolCalls: { orderBy: { createdAt: 'asc' } } },
      },
    },
  })
}

export function listConversationsForUser(
  db: PrismaClient,
  tenantId: string,
  userId: string,
  take = 50,
) {
  return db.assistantConversation.findMany({
    where: { tenantId, userId },
    orderBy: { updatedAt: 'desc' },
    take,
    select: { id: true, title: true, source: true, createdAt: true, updatedAt: true },
  })
}

export interface ToolCallTrace {
  toolUseId: string
  toolName: string
  input: unknown
  allowed: boolean
  resultCount: number | null
  resultSummary: string | null
  error: string | null
  durationMs: number
}

export interface ExchangeRecord {
  tenantId: string
  conversationId: string
  /** Content blocks of the user message exactly as sent (cache-stable replay). */
  userContent: unknown[]
  assistantText: string
  modelId: string
  promptVersionId: string | null
  stopReason: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  modelRounds: number
  latencyMs: number
  error: string | null
  toolCalls: ToolCallTrace[]
}

const SUMMARY_CHARS = 4_000

/**
 * Persist one user → assistant exchange: both turns and every tool call, in
 * one transaction so a trace is never half-written. Returns the assistant
 * turn's id.
 */
export async function recordExchange(db: PrismaClient, r: ExchangeRecord): Promise<string> {
  return db.$transaction(async (tx) => {
    const agg = await tx.assistantTurn.aggregate({
      where: { tenantId: r.tenantId, conversationId: r.conversationId },
      _max: { seq: true },
    })
    const seq = (agg._max.seq ?? -1) + 1
    await tx.assistantTurn.create({
      data: {
        tenantId: r.tenantId,
        conversationId: r.conversationId,
        seq,
        role: 'user',
        content: r.userContent as Prisma.InputJsonValue,
      },
    })
    const turn = await tx.assistantTurn.create({
      data: {
        tenantId: r.tenantId,
        conversationId: r.conversationId,
        seq: seq + 1,
        role: 'assistant',
        content: [{ type: 'text', text: r.assistantText }] as Prisma.InputJsonValue,
        modelId: r.modelId,
        promptVersionId: r.promptVersionId,
        stopReason: r.stopReason,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheReadTokens: r.cacheReadTokens,
        cacheWriteTokens: r.cacheWriteTokens,
        modelRounds: r.modelRounds,
        latencyMs: r.latencyMs,
        error: r.error,
      },
    })
    if (r.toolCalls.length > 0) {
      await tx.assistantToolCall.createMany({
        data: r.toolCalls.map((t) => ({
          tenantId: r.tenantId,
          turnId: turn.id,
          toolUseId: t.toolUseId,
          toolName: t.toolName,
          input: (t.input ?? {}) as Prisma.InputJsonValue,
          allowed: t.allowed,
          resultCount: t.resultCount,
          resultSummary: t.resultSummary ? t.resultSummary.slice(0, SUMMARY_CHARS) : null,
          error: t.error,
          durationMs: t.durationMs,
        })),
      })
    }
    await tx.assistantConversation.updateMany({
      where: { tenantId: r.tenantId, id: r.conversationId },
      data: { updatedAt: new Date() },
    })
    return turn.id
  })
}
