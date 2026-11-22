// Provider resolution: which adapter serves the model, and the model-id guard.
// The adapters' own SDK loading is mocked; their translation is tested in
// converse.test.ts and anthropic.test.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  resolveInferenceProvider,
  setInferenceProviderForTests,
  inferenceApi,
  DEFAULT_ASSISTANT_MODEL_ID,
} from './provider'

// vi.mock is hoisted above the imports, so its spies must be hoisted too.
const { converse, anthropic } = vi.hoisted(() => ({
  converse: vi.fn(async (o: { modelId: string; region: string }) => ({
    name: 'bedrock-converse',
    ...o,
  })),
  anthropic: vi.fn(async (o: { modelId: string; region: string }) => ({
    name: 'bedrock-anthropic',
    ...o,
  })),
}))
vi.mock('./converse', () => ({ createConverseProvider: converse }))
vi.mock('./anthropic', () => ({ createAnthropicBedrockProvider: anthropic }))

const ENV = ['ASSISTANT_MODEL_ID', 'ASSISTANT_INFERENCE_API', 'AWS_REGION'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  converse.mockClear()
  anthropic.mockClear()
  setInferenceProviderForTests(null) // also clears the per-process cache
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  setInferenceProviderForTests(null)
})

describe('resolveInferenceProvider', () => {
  it('defaults to Converse, the US Opus profile and us-east-1', async () => {
    const p = await resolveInferenceProvider()
    expect(p.name).toBe('bedrock-converse')
    expect(converse).toHaveBeenCalledWith({
      modelId: DEFAULT_ASSISTANT_MODEL_ID,
      region: 'us-east-1',
    })
    expect(anthropic).not.toHaveBeenCalled()
  })

  it('takes the model and region from the environment, and caches the provider', async () => {
    process.env['ASSISTANT_MODEL_ID'] = 'us.anthropic.claude-haiku-5-5'
    process.env['AWS_REGION'] = 'us-west-2'
    const a = await resolveInferenceProvider()
    const b = await resolveInferenceProvider()
    expect(a).toBe(b)
    expect(converse).toHaveBeenCalledTimes(1)
    expect(converse).toHaveBeenCalledWith({
      modelId: 'us.anthropic.claude-haiku-5-5',
      region: 'us-west-2',
    })
  })

  it('selects the Anthropic Messages adapter for A/B evals', async () => {
    process.env['ASSISTANT_INFERENCE_API'] = 'anthropic'
    const p = await resolveInferenceProvider()
    expect(p.name).toBe('bedrock-anthropic')
    expect(converse).not.toHaveBeenCalled()
  })

  it('refuses a global.* profile, which would route tenant data worldwide', async () => {
    process.env['ASSISTANT_MODEL_ID'] = 'global.anthropic.claude-opus-5'
    await expect(resolveInferenceProvider()).rejects.toThrow(/must not be a global\.\* profile/)
    expect(converse).not.toHaveBeenCalled()
  })

  it('serves the test override when one is set', async () => {
    const fake = { name: 'fake', modelId: 'm', streamRound: vi.fn() }
    setInferenceProviderForTests(fake)
    expect(await resolveInferenceProvider()).toBe(fake)
  })
})

describe('inferenceApi', () => {
  it('rejects an unknown value instead of silently picking one', () => {
    process.env['ASSISTANT_INFERENCE_API'] = 'openai'
    expect(() => inferenceApi()).toThrow(/converse or anthropic/)
  })
})
