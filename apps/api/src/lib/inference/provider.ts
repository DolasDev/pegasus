// ---------------------------------------------------------------------------
// Inference provider seam — the one place that knows WHICH LLM backend serves
// a request. Deliberately neutral (lib/, not assistant/): the assistant is the
// first consumer, and LLM calls from workflows (plan "Phase 4") are a foreseen
// second one. See plans/in-progress/ai-chat-assistant.md, Infrastructure §2.
//
// Production backend: Claude in Amazon Bedrock through the DEFAULT
// `AnthropicBedrock` client. That client calls
//   /model/{id}/invoke and /model/{id}/invoke-with-response-stream
// which the Service Authorization Reference maps to `bedrock:InvokeModel` and
// `bedrock:InvokeModelWithResponseStream` — exactly the grant wired in
// packages/infra. Do NOT switch to the `mantle-client` export or the
// `bedrock-runtime…/anthropic` Messages path: neither is in that reference, so
// the pinned grant would not cover it.
//
// Credentials: SigV4 from the Lambda execution role (the default AWS provider
// chain). There is no API key anywhere.
// ---------------------------------------------------------------------------

import type Anthropic from '@anthropic-ai/sdk'

// The Bedrock SDK is loaded LAZILY (dynamic import in createBedrockProvider), on
// the first real model call. Its modules `require('@aws-sdk/client-bedrock-runtime')`
// at load time, and the API bundle leaves `@aws-sdk/*` external (resolved from
// the Lambda runtime). app.ts imports the assistant router, so a static import
// here would put that require on the MAIN API Lambda's cold start — the #594
// INIT-crash class. Lazy, a problem can only fail an assistant turn.

/**
 * The slice of an Anthropic client the assistant uses. Both the first-party
 * `Anthropic` client (tests drive it with a scripted `fetch`) and
 * `AnthropicBedrock` satisfy it.
 */
export interface InferenceClient {
  readonly beta: {
    readonly messages: Pick<Anthropic['beta']['messages'], 'toolRunner' | 'create'>
  }
}

export interface InferenceProvider {
  /** `bedrock` in production; `fake` in tests. Recorded on every trace. */
  readonly name: string
  /** The model id sent on every request (a Bedrock inference profile id). */
  readonly modelId: string
  readonly client: InferenceClient
}

/**
 * US geo cross-region inference profile. From us-east-1 it routes only to
 * us-east-1, us-east-2 and us-west-2. Never a `global.*` profile — that would
 * route worldwide and undo the data-residency reason for choosing Bedrock.
 */
export const DEFAULT_ASSISTANT_MODEL_ID = 'us.anthropic.claude-opus-5'

export async function createBedrockProvider(opts: {
  modelId: string
  region: string
}): Promise<InferenceProvider> {
  const { AnthropicBedrock } = await import('@anthropic-ai/bedrock-sdk')
  const client = new AnthropicBedrock({ awsRegion: opts.region })
  return {
    name: 'bedrock',
    modelId: opts.modelId,
    // AnthropicBedrock omits batches/countTokens from `beta.messages`, but keeps
    // `create` and `toolRunner`, which is all InferenceClient asks for.
    client: client as unknown as InferenceClient,
  }
}

let override: InferenceProvider | null = null
let cached: InferenceProvider | null = null

/** Tests (and only tests) swap in a scripted provider. */
export function setInferenceProviderForTests(provider: InferenceProvider | null): void {
  override = provider
}

/**
 * Resolve the provider for this process. `ASSISTANT_MODEL_ID` overrides the
 * model (the eval sweep and the planned Sonnet step-down use it); the region is
 * the Lambda's own.
 */
export async function resolveInferenceProvider(): Promise<InferenceProvider> {
  if (override) return override
  if (cached) return cached
  const modelId = process.env['ASSISTANT_MODEL_ID'] || DEFAULT_ASSISTANT_MODEL_ID
  if (modelId.startsWith('global.')) {
    // Fail loudly rather than silently route tenant data worldwide.
    throw new Error(`ASSISTANT_MODEL_ID must not be a global.* profile (got ${modelId})`)
  }
  const region = process.env['AWS_REGION'] || 'us-east-1'
  cached = await createBedrockProvider({ modelId, region })
  return cached
}
