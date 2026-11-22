// ---------------------------------------------------------------------------
// Bedrock Converse adapter: one model round over ConverseStream (plan D1, D7).
//
// Converse is Bedrock's model-neutral chat API, so the same request works for
// Claude, Nova, Mistral and the rest. Per-family differences (cache points,
// effort) come from models.ts.
//
// IAM: "To call ConverseStream, you require permission for the
// bedrock:InvokeModelWithResponseStream operation" (Bedrock user guide). That
// is the grant already pinned in packages/infra. Nothing else is needed: the
// SAR's ApplyGuardrail / CallWithBearerToken / InvokeTool apply only to
// guardrails, API keys and server tools, none of which this uses.
//
// The AWS client is imported LAZILY, on the first round. This module is
// reachable from app.ts, and the main API Lambda must not load it at INIT
// (the #594 class). Types are `import type` only, which are erased.
// ---------------------------------------------------------------------------

import type {
  ContentBlock,
  ConverseStreamCommandInput,
  ConverseStreamOutput,
  Message,
  SystemContentBlock,
  Tool,
} from '@aws-sdk/client-bedrock-runtime'
import { modelFamily } from './models'
import type {
  ChatMessage,
  ContentPart,
  InferenceProvider,
  RoundEvent,
  RoundRequest,
  RoundUsage,
} from './types'

/** Sends one ConverseStream request and returns its event stream. Injected so tests can replay a recording. */
export type ConverseSend = (
  input: ConverseStreamCommandInput,
  signal?: AbortSignal,
) => Promise<AsyncIterable<ConverseStreamOutput>>

const CACHE_POINT = { cachePoint: { type: 'default' } } as const

function toBlock(part: ContentPart): ContentBlock | null {
  switch (part.type) {
    case 'text':
      // Converse rejects blank text blocks.
      return part.text ? { text: part.text } : null
    case 'tool_use':
      return {
        toolUse: { toolUseId: part.id, name: part.name, input: part.input as never },
      }
    case 'tool_result':
      return {
        toolResult: {
          toolUseId: part.toolUseId,
          content: [{ text: part.content }],
          status: part.isError ? 'error' : 'success',
        },
      }
    case 'reasoning':
      // Echoed back exactly as this adapter produced it (see readStream).
      return part.raw as ContentBlock
  }
}

function toMessage(m: ChatMessage): Message {
  return {
    role: m.role,
    content: m.content.map(toBlock).filter((b): b is ContentBlock => b !== null),
  }
}

/** The ConverseStream request for one round. Exported for the adapter test. */
export function buildConverseRequest(
  modelId: string,
  req: RoundRequest,
): ConverseStreamCommandInput {
  const family = modelFamily(modelId)
  const system: SystemContentBlock[] = req.system.filter((s) => s).map((text) => ({ text }))
  // One cache point after the system prompt caches tools + system: Bedrock
  // chains checkpoints tools → system → messages. Where a family takes none in
  // system but does in tools, cache the tools alone.
  if (req.cache && family.cachePoints.system) system.push(CACHE_POINT)

  const input: ConverseStreamCommandInput = {
    modelId,
    system,
    messages: req.messages.map(toMessage),
    inferenceConfig: { maxTokens: req.maxTokens },
  }
  if (req.tools.length > 0) {
    const tools: Tool[] = req.tools.map((t) => ({
      toolSpec: {
        name: t.name,
        description: t.description,
        inputSchema: { json: t.inputSchema as never },
      },
    }))
    if (req.cache && family.cachePoints.tools && !family.cachePoints.system) tools.push(CACHE_POINT)
    input.toolConfig = { tools }
  }
  const extra = family.requestFields(req.effort)
  if (extra) input.additionalModelRequestFields = extra as never
  return input
}

type Builder =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; json: string }
  | {
      kind: 'reasoning'
      text: string
      signature: string | undefined
      redacted: Uint8Array | undefined
    }

function finish(b: Builder): ContentPart {
  if (b.kind === 'text') return { type: 'text', text: b.text }
  if (b.kind === 'reasoning') {
    const raw: ContentBlock = b.redacted
      ? { reasoningContent: { redactedContent: b.redacted } }
      : {
          reasoningContent: {
            reasoningText: { text: b.text, ...(b.signature ? { signature: b.signature } : {}) },
          },
        }
    return { type: 'reasoning', raw }
  }
  if (!b.json.trim()) return { type: 'tool_use', id: b.id, name: b.name, input: {} }
  try {
    return { type: 'tool_use', id: b.id, name: b.name, input: JSON.parse(b.json) as unknown }
  } catch {
    return {
      type: 'tool_use',
      id: b.id,
      name: b.name,
      input: {},
      inputError: 'The tool input was not valid JSON.',
    }
  }
}

const STREAM_ERRORS = [
  'internalServerException',
  'modelStreamErrorException',
  'validationException',
  'throttlingException',
  'serviceUnavailableException',
] as const

/** Assemble a ConverseStream into neutral round events. Exported for the adapter test. */
export async function* readConverseStream(
  stream: AsyncIterable<ConverseStreamOutput>,
): AsyncGenerator<RoundEvent> {
  const blocks = new Map<number, Builder>()
  const done: Array<[number, ContentPart]> = []
  let stopReason: string | null = null
  const usage: RoundUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }

  for await (const ev of stream) {
    for (const name of STREAM_ERRORS) {
      const err = (ev as unknown as Record<string, { message?: string } | undefined>)[name]
      if (err) throw new Error(`${name}: ${err.message ?? 'stream error'}`)
    }
    if (ev.contentBlockStart) {
      const i = ev.contentBlockStart.contentBlockIndex ?? 0
      const tu = ev.contentBlockStart.start?.toolUse
      if (tu) blocks.set(i, { kind: 'tool', id: tu.toolUseId ?? '', name: tu.name ?? '', json: '' })
    } else if (ev.contentBlockDelta) {
      const i = ev.contentBlockDelta.contentBlockIndex ?? 0
      const d = ev.contentBlockDelta.delta
      if (!d) continue
      if (d.text !== undefined) {
        const b = blocks.get(i)
        if (b?.kind === 'text') b.text += d.text
        else blocks.set(i, { kind: 'text', text: d.text })
        if (d.text) yield { type: 'text_delta', text: d.text }
      } else if (d.toolUse) {
        const b = blocks.get(i)
        if (b?.kind === 'tool') b.json += d.toolUse.input ?? ''
      } else if (d.reasoningContent) {
        let b = blocks.get(i)
        if (b?.kind !== 'reasoning') {
          b = { kind: 'reasoning', text: '', signature: undefined, redacted: undefined }
          blocks.set(i, b)
        }
        const r = d.reasoningContent
        if (r.text !== undefined) b.text += r.text
        if (r.signature !== undefined) b.signature = r.signature
        if (r.redactedContent !== undefined) b.redacted = r.redactedContent
      }
    } else if (ev.contentBlockStop) {
      const i = ev.contentBlockStop.contentBlockIndex ?? 0
      const b = blocks.get(i)
      if (b) {
        done.push([i, finish(b)])
        blocks.delete(i)
      }
    } else if (ev.messageStop) {
      stopReason = ev.messageStop.stopReason ?? null
    } else if (ev.metadata?.usage) {
      const u = ev.metadata.usage
      usage.inputTokens = u.inputTokens ?? 0
      usage.outputTokens = u.outputTokens ?? 0
      usage.cacheReadTokens = u.cacheReadInputTokens ?? 0
      usage.cacheWriteTokens = u.cacheWriteInputTokens ?? 0
    }
  }
  // A block the stream never closed is still part of the answer.
  for (const [i, b] of blocks) done.push([i, finish(b)])
  done.sort((a, b) => a[0] - b[0])
  yield { type: 'round_end', content: done.map(([, p]) => p), stopReason, usage }
}

/** Keep the AWS error name (AccessDeniedException, ThrottlingException, …) in the message. */
function named(err: unknown): Error {
  if (err instanceof Error) {
    if (err.name && err.name !== 'Error' && !err.message.startsWith(err.name)) {
      return new Error(`${err.name}: ${err.message}`)
    }
    return err
  }
  return new Error(String(err))
}

export function converseProvider(modelId: string, send: ConverseSend): InferenceProvider {
  return {
    name: 'bedrock-converse',
    modelId,
    async *streamRound(request, signal) {
      let stream: AsyncIterable<ConverseStreamOutput>
      try {
        stream = await send(buildConverseRequest(modelId, request), signal)
      } catch (err) {
        throw named(err)
      }
      try {
        yield* readConverseStream(stream)
      } catch (err) {
        throw named(err)
      }
    },
  }
}

export async function createConverseProvider(opts: {
  modelId: string
  region: string
}): Promise<InferenceProvider> {
  const { BedrockRuntimeClient, ConverseStreamCommand } =
    await import('@aws-sdk/client-bedrock-runtime')
  const client = new BedrockRuntimeClient({ region: opts.region })
  return converseProvider(opts.modelId, async (input, signal) => {
    const out = await client.send(
      new ConverseStreamCommand(input),
      signal ? { abortSignal: signal } : undefined,
    )
    if (!out.stream) throw new Error('ConverseStream returned no stream')
    return out.stream
  })
}
