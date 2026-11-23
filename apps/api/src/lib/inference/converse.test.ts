// The Converse adapter's own translation, in both directions (plan D9).
//
// The event sequence below is hand-written from the AWS SDK's
// ConverseStreamOutput types. Replace it with a sequence recorded from a real
// staging call when V1 runs (plan step 10), and keep the assertions.

import { describe, it, expect } from 'vitest'
import type {
  ConverseStreamCommandInput,
  ConverseStreamOutput,
} from '@aws-sdk/client-bedrock-runtime'
import { buildConverseRequest, converseProvider, readConverseStream } from './converse'
import type { RoundEvent, RoundRequest } from './types'

const REQUEST: RoundRequest = {
  system: ['base rules', 'ops prompt'],
  tools: [
    {
      name: 'list_drivers',
      description: 'List drivers',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
    },
  ],
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: '(ctx)' },
        { type: 'text', text: 'q' },
      ],
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'reasoning',
          raw: { reasoningContent: { reasoningText: { text: 'r', signature: 's' } } },
        },
        { type: 'text', text: '' },
        { type: 'tool_use', id: 'tu_1', name: 'list_drivers', input: { name: 'smi' } },
      ],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', toolUseId: 'tu_1', content: '[]', isError: true }],
    },
  ],
  maxTokens: 4096,
  effort: 'medium',
  cache: true,
}

async function* replay(events: ConverseStreamOutput[]): AsyncGenerator<ConverseStreamOutput> {
  for (const e of events) yield e
}

async function collect(it: AsyncIterable<RoundEvent>): Promise<RoundEvent[]> {
  const out: RoundEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

describe('buildConverseRequest', () => {
  it('maps a Claude round: cache point after the system prompt, effort via additional fields', () => {
    expect(buildConverseRequest('us.anthropic.claude-opus-5', REQUEST)).toEqual({
      modelId: 'us.anthropic.claude-opus-5',
      system: [{ text: 'base rules' }, { text: 'ops prompt' }, { cachePoint: { type: 'default' } }],
      messages: [
        { role: 'user', content: [{ text: '(ctx)' }, { text: 'q' }] },
        {
          role: 'assistant',
          content: [
            { reasoningContent: { reasoningText: { text: 'r', signature: 's' } } },
            // the blank text block is dropped: Converse rejects it
            { toolUse: { toolUseId: 'tu_1', name: 'list_drivers', input: { name: 'smi' } } },
          ],
        },
        {
          role: 'user',
          content: [
            { toolResult: { toolUseId: 'tu_1', content: [{ text: '[]' }], status: 'error' } },
          ],
        },
      ],
      inferenceConfig: { maxTokens: 4096 },
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: 'list_drivers',
              description: 'List drivers',
              inputSchema: { json: { type: 'object', properties: { name: { type: 'string' } } } },
            },
          },
        ],
      },
      additionalModelRequestFields: { output_config: { effort: 'medium' } },
    })
  })

  it('sends no cache point and no extra fields to a family without them', () => {
    const req = buildConverseRequest('us.mistral.mistral-large-3', REQUEST)
    expect(req.system).toEqual([{ text: 'base rules' }, { text: 'ops prompt' }])
    expect(req.additionalModelRequestFields).toBeUndefined()
  })

  it('caches system but never tools for Nova', () => {
    const req = buildConverseRequest('us.amazon.nova-2-lite-v1:0', REQUEST)
    expect(req.system?.at(-1)).toEqual({ cachePoint: { type: 'default' } })
    expect(JSON.stringify(req.toolConfig)).not.toContain('cachePoint')
    expect(req.additionalModelRequestFields).toBeUndefined()
  })

  it('omits the cache point when caching is off and toolConfig when there are no tools', () => {
    const req = buildConverseRequest('us.anthropic.claude-opus-5', {
      ...REQUEST,
      tools: [],
      cache: false,
    })
    expect(JSON.stringify(req)).not.toContain('cachePoint')
    expect(req.toolConfig).toBeUndefined()
  })
})

describe('readConverseStream', () => {
  it('assembles text, reasoning and a tool call, with usage and stop reason', async () => {
    const events = await collect(
      readConverseStream(
        replay([
          { messageStart: { role: 'assistant' } },
          {
            contentBlockDelta: {
              contentBlockIndex: 0,
              delta: { reasoningContent: { text: 'Let me ' } },
            },
          },
          {
            contentBlockDelta: {
              contentBlockIndex: 0,
              delta: { reasoningContent: { text: 'look.' } },
            },
          },
          {
            contentBlockDelta: {
              contentBlockIndex: 0,
              delta: { reasoningContent: { signature: 'sig' } },
            },
          },
          { contentBlockStop: { contentBlockIndex: 0 } },
          { contentBlockDelta: { contentBlockIndex: 1, delta: { text: 'Checking ' } } },
          { contentBlockDelta: { contentBlockIndex: 1, delta: { text: 'drivers.' } } },
          { contentBlockStop: { contentBlockIndex: 1 } },
          {
            contentBlockStart: {
              contentBlockIndex: 2,
              start: { toolUse: { toolUseId: 'tu_1', name: 'list_drivers' } },
            },
          },
          {
            contentBlockDelta: { contentBlockIndex: 2, delta: { toolUse: { input: '{"name":' } } },
          },
          { contentBlockDelta: { contentBlockIndex: 2, delta: { toolUse: { input: '"smi"}' } } } },
          { contentBlockStop: { contentBlockIndex: 2 } },
          { messageStop: { stopReason: 'tool_use' } },
          {
            metadata: {
              usage: {
                inputTokens: 40,
                outputTokens: 30,
                totalTokens: 1070,
                cacheReadInputTokens: 1000,
                cacheWriteInputTokens: 0,
              },
              metrics: { latencyMs: 900 },
            },
          },
        ]),
      ),
    )
    expect(events).toEqual([
      { type: 'text_delta', text: 'Checking ' },
      { type: 'text_delta', text: 'drivers.' },
      {
        type: 'round_end',
        content: [
          {
            type: 'reasoning',
            raw: {
              reasoningContent: { reasoningText: { text: 'Let me look.', signature: 'sig' } },
            },
          },
          { type: 'text', text: 'Checking drivers.' },
          { type: 'tool_use', id: 'tu_1', name: 'list_drivers', input: { name: 'smi' } },
        ],
        stopReason: 'tool_use',
        usage: { inputTokens: 40, outputTokens: 30, cacheReadTokens: 1000, cacheWriteTokens: 0 },
      },
    ])
  })

  it('marks unparseable tool input instead of throwing, and treats empty input as {}', async () => {
    const events = await collect(
      readConverseStream(
        replay([
          {
            contentBlockStart: {
              contentBlockIndex: 0,
              start: { toolUse: { toolUseId: 'a', name: 'x' } },
            },
          },
          {
            contentBlockDelta: { contentBlockIndex: 0, delta: { toolUse: { input: '{"name":' } } },
          },
          { contentBlockStop: { contentBlockIndex: 0 } },
          {
            contentBlockStart: {
              contentBlockIndex: 1,
              start: { toolUse: { toolUseId: 'b', name: 'y' } },
            },
          },
          { contentBlockStop: { contentBlockIndex: 1 } },
          { messageStop: { stopReason: 'tool_use' } },
        ]),
      ),
    )
    const end = events.at(-1) as Extract<RoundEvent, { type: 'round_end' }>
    expect(end.content).toEqual([
      {
        type: 'tool_use',
        id: 'a',
        name: 'x',
        input: {},
        inputError: 'The tool input was not valid JSON.',
      },
      { type: 'tool_use', id: 'b', name: 'y', input: {} },
    ])
  })

  it('keeps redacted reasoning opaque', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const events = await collect(
      readConverseStream(
        replay([
          {
            contentBlockDelta: {
              contentBlockIndex: 0,
              delta: { reasoningContent: { redactedContent: bytes } },
            },
          },
          { contentBlockStop: { contentBlockIndex: 0 } },
          { messageStop: { stopReason: 'end_turn' } },
        ]),
      ),
    )
    const end = events.at(-1) as Extract<RoundEvent, { type: 'round_end' }>
    expect(end.content).toEqual([
      { type: 'reasoning', raw: { reasoningContent: { redactedContent: bytes } } },
    ])
  })

  it('throws a mid-stream exception event with its name', async () => {
    await expect(
      collect(
        readConverseStream(
          replay([
            { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'a' } } },
            {
              throttlingException: { name: 'ThrottlingException', message: 'slow down' },
            } as unknown as ConverseStreamOutput,
          ]),
        ),
      ),
    ).rejects.toThrow('throttlingException: slow down')
  })
})

describe('converseProvider', () => {
  it('sends the built request with the abort signal and streams the round', async () => {
    const sent: Array<{ input: ConverseStreamCommandInput; signal?: AbortSignal }> = []
    const provider = converseProvider('us.anthropic.claude-opus-5', async (input, signal) => {
      sent.push({ input, ...(signal ? { signal } : {}) })
      return replay([
        { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'ok' } } },
        { contentBlockStop: { contentBlockIndex: 0 } },
        { messageStop: { stopReason: 'end_turn' } },
      ])
    })
    const ac = new AbortController()
    const events = await collect(provider.streamRound(REQUEST, ac.signal))
    expect(provider.name).toBe('bedrock-converse')
    expect(sent[0]!.input.modelId).toBe('us.anthropic.claude-opus-5')
    expect(sent[0]!.signal).toBe(ac.signal)
    expect(events.at(-1)).toMatchObject({ type: 'round_end', stopReason: 'end_turn' })
  })

  it('keeps the AWS error name, so a missing use-case form or grant is recognisable', async () => {
    const provider = converseProvider('us.anthropic.claude-opus-5', async () => {
      const err = new Error('You do not have access to the model')
      err.name = 'AccessDeniedException'
      throw err
    })
    await expect(collect(provider.streamRound(REQUEST))).rejects.toThrow(
      'AccessDeniedException: You do not have access to the model',
    )
  })
})
