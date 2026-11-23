// ---------------------------------------------------------------------------
// Per-model-family behaviour on Bedrock Converse (plan D4), deliberately small.
//
// Converse normalises messages, tools and usage across models. It does NOT
// normalise prompt caching (which fields accept a `cachePoint`) or model
// knobs such as Anthropic's effort, which go through
// `additionalModelRequestFields`. This table holds exactly those differences.
// An unknown family gets no cache points and no extra fields: it works, it
// just isn't tuned.
//
// Sources (AWS Bedrock user guide, "Prompt caching", checked 2026-11-20):
// Claude models accept checkpoints in tools, system and messages; Nova in
// system and messages only; for OpenAI models "Converse doesn't support
// explicit caching".
// ---------------------------------------------------------------------------

import type { Effort } from './types'

export interface ModelFamily {
  readonly id: string
  /** Which request sections accept a Converse `cachePoint`. */
  readonly cachePoints: { readonly tools: boolean; readonly system: boolean }
  /** Model-specific fields for `additionalModelRequestFields`, or none. */
  requestFields(effort: Effort): Record<string, unknown> | undefined
}

const ANTHROPIC: ModelFamily = {
  id: 'anthropic',
  cachePoints: { tools: true, system: true },
  requestFields: (effort) => ({ output_config: { effort } }),
}

const NOVA: ModelFamily = {
  id: 'amazon-nova',
  cachePoints: { tools: false, system: true },
  requestFields: () => undefined,
}

const GENERIC: ModelFamily = {
  id: 'generic',
  cachePoints: { tools: false, system: false },
  requestFields: () => undefined,
}

/** Cross-region inference profile prefixes (`us.anthropic.…`) carry no family meaning. */
const GEO_PREFIX = /^(us|us-gov|eu|apac|jp|au|ca|global)\./

/** The foundation-model id behind an inference profile id. */
export function baseModelId(modelId: string): string {
  return modelId.replace(GEO_PREFIX, '')
}

export function modelFamily(modelId: string): ModelFamily {
  const base = baseModelId(modelId)
  if (base.startsWith('anthropic.')) return ANTHROPIC
  if (base.startsWith('amazon.nova')) return NOVA
  return GENERIC
}
