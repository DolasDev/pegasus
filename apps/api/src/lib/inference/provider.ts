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

/** The model chat uses: `ASSISTANT_MODEL_ID`, set by CDK from the stack's default. */
export function defaultModelId(): string {
  return process.env['ASSISTANT_MODEL_ID'] || DEFAULT_ASSISTANT_MODEL_ID
}

/**
 * The models this deployment may call (assistant-converse plan, D8):
 * `ASSISTANT_ALLOWED_MODELS` (comma list, set by CDK from the same list the IAM
 * grant covers) plus the default. Absent → the default only (fail closed).
 */
export function allowedModelIds(): string[] {
  const listed = (process.env['ASSISTANT_ALLOWED_MODELS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  const def = defaultModelId()
  return listed.includes(def) ? listed : [def, ...listed]
}

export function isAllowedModel(modelId: string): boolean {
  return allowedModelIds().includes(modelId)
}

let override: InferenceProvider | null = null
const cached = new Map<string, InferenceProvider>()

/** Tests (and only tests) swap in a scripted provider. */
export function setInferenceProviderForTests(provider: InferenceProvider | null): void {
  override = provider
  cached.clear()
}

/**
 * Resolve the provider for a model (default: `ASSISTANT_MODEL_ID`), cached per
 * model for the life of the process. `ASSISTANT_INFERENCE_API` picks the
 * adapter; the region is the Lambda's own. Callers taking a model id from a
 * request check `isAllowedModel` first, so a bad id is a 400, not a 503.
 */
export async function resolveInferenceProvider(requested?: string): Promise<InferenceProvider> {
  if (override) return override
  const modelId = requested ?? defaultModelId()
  const hit = cached.get(modelId)
  if (hit) return hit
  if (modelId.startsWith('global.')) {
    // Fail loudly rather than silently route tenant data worldwide.
    throw new Error(`The assistant model must not be a global.* profile (got ${modelId})`)
  }
  if (!isAllowedModel(modelId)) {
    throw new Error(`Model ${modelId} is not in ASSISTANT_ALLOWED_MODELS`)
  }
  const region = process.env['AWS_REGION'] || 'us-east-1'
  let provider: InferenceProvider
  if (inferenceApi() === 'anthropic') {
    // The Messages path serves Claude only. Dies with the adapter (plan step 15).
    if (!/(^|\.)anthropic\./.test(modelId)) {
      throw new Error(`ASSISTANT_INFERENCE_API=anthropic cannot serve ${modelId}`)
    }
    const { createAnthropicBedrockProvider } = await import('./anthropic')
    provider = await createAnthropicBedrockProvider({ modelId, region })
  } else {
    const { createConverseProvider } = await import('./converse')
    provider = await createConverseProvider({ modelId, region })
  }
  cached.set(modelId, provider)
  return provider
}
