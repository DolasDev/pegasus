// ---------------------------------------------------------------------------
// Inference provider resolution — the one place that decides WHICH backend
// serves a request. Deliberately neutral (lib/, not assistant/): the assistant
// is the first consumer, and LLM calls from workflows (plan "Phase 4") are a
// foreseen second one. See plans/*/ai-chat-assistant.md, Infrastructure §2,
// and plans/*/assistant-converse.md.
//
// Production: Amazon Bedrock, SigV4 from the Lambda execution role (the
// default AWS provider chain); there is no API key anywhere. Two adapters:
//   - converse  (default): Bedrock Converse, any Bedrock chat model.
//   - anthropic: Anthropic Messages on the InvokeModel path (Phase 1's path),
//     kept for one release for A/B evals. Remove with plan step 15.
// Both map to the pinned bedrock:InvokeModel[WithResponseStream] grant.
//
// Both adapters load their SDK LAZILY on the first model call (#594 class);
// a load failure surfaces as 503 ASSISTANT_UNAVAILABLE in assistant/http.ts.
// ---------------------------------------------------------------------------

import type { InferenceProvider } from './types'

export type { InferenceProvider } from './types'

/**
 * US geo cross-region inference profile. From us-east-1 it routes only to
 * us-east-1, us-east-2 and us-west-2. Never a `global.*` profile — that would
 * route worldwide and undo the data-residency reason for choosing Bedrock.
 */
export const DEFAULT_ASSISTANT_MODEL_ID = 'us.anthropic.claude-opus-5'

export type InferenceApi = 'converse' | 'anthropic'

export function inferenceApi(): InferenceApi {
  const v = process.env['ASSISTANT_INFERENCE_API']
  if (!v || v === 'converse') return 'converse'
  if (v === 'anthropic') return 'anthropic'
  throw new Error(`ASSISTANT_INFERENCE_API must be converse or anthropic (got ${v})`)
}

let override: InferenceProvider | null = null
let cached: InferenceProvider | null = null

/** Tests (and only tests) swap in a scripted provider. */
export function setInferenceProviderForTests(provider: InferenceProvider | null): void {
  override = provider
  cached = null
}

/**
 * Resolve the provider for this process. `ASSISTANT_MODEL_ID` sets the model,
 * `ASSISTANT_INFERENCE_API` the adapter; the region is the Lambda's own.
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
  if (inferenceApi() === 'anthropic') {
    const { createAnthropicBedrockProvider } = await import('./anthropic')
    cached = await createAnthropicBedrockProvider({ modelId, region })
  } else {
    const { createConverseProvider } = await import('./converse')
    cached = await createConverseProvider({ modelId, region })
  }
  return cached
}
