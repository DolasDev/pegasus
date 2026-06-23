// ---------------------------------------------------------------------------
// Built-in golden corpora, keyed by integration id. Lets the publish script (and
// any future self-publish path) resolve the corpus for an integration the same
// way the registry resolves its definition. Only built-ins with a published
// corpus appear here.
// ---------------------------------------------------------------------------

import type { GateCorpusCase } from '../gate-pipeline'
import { longhaulCorpus } from './longhaul.corpus'
import { weichertCorpus } from './weichert.corpus'

export { longhaulCorpus, weichertCorpus }

export const BUILTIN_CORPORA: Record<string, GateCorpusCase[]> = {
  longhaul: longhaulCorpus,
  weichert: weichertCorpus,
}

/**
 * The full corpus for a built-in integration (every `__corpus__/<id>` fixture),
 * or undefined if none is bundled. Includes structural-rejection fixtures, so
 * this is the set to replay through the live `validate` path (Phase 4 parity).
 */
export function getBuiltinCorpus(integrationId: string): GateCorpusCase[] | undefined {
  return BUILTIN_CORPORA[integrationId]
}

/**
 * The ruleId `validate` emits when the mapped output fails the structural
 * contract (see validate.ts `transformToCanonical`). A fixture expecting it is a
 * deliberately-malformed order whose mapped output does NOT parse.
 */
export const STRUCTURAL_RULE_ID = 'structural-contract'

/**
 * The publish/gate-eligible subset of a built-in's corpus.
 *
 * The gate pipeline's structural round-trip stage requires every corpus order to
 * parse against the canonical contract — a fixture that *expects* a structural
 * rejection (its mapped output is intentionally non-parsing) is a `validate`-path
 * test, not a mapping-correctness fixture, and would fail the gate. Those are
 * dropped here so the assembled publish body passes the gate. The structural
 * contract is code (the floor) that a published config can never override, so
 * nothing is lost by omitting these from the stored corpus.
 */
export function getGateCorpus(integrationId: string): GateCorpusCase[] | undefined {
  const corpus = BUILTIN_CORPORA[integrationId]
  if (!corpus) return undefined
  return corpus.filter((c) => !c.expected.ruleIds.includes(STRUCTURAL_RULE_ID))
}
