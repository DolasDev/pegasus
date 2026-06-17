// ---------------------------------------------------------------------------
// Integration registry — the multi-integration seam, kept as DATA from day one.
//
// The POC ships exactly ONE entry (longhaul), supported globally (a single
// shared definition, not per-tenant — POC plan, Open Question #2). Adding
// integration #2 is a new entry here plus its own transform/rules files; the
// engine and the endpoint never change. Nothing about "longhaul" is referenced
// outside this map.
// ---------------------------------------------------------------------------

import { CanonicalOrderSchema } from './canonical-order'
import { compileMapping } from './transform/mapping-format'
import { longhaulMapping, longhaulInputFieldRoots } from './transform/longhaul.transform'
import { deriveLonghaulFacts, longhaulFactCatalog } from './facts/longhaul-facts'
import { longhaulRules } from './rules/longhaul.rules'
import type { IntegrationDefinition } from './types'

const longhaulDefinition: IntegrationDefinition = {
  id: 'longhaul',
  structuralContract: CanonicalOrderSchema,
  mapping: longhaulMapping,
  transform: compileMapping(longhaulMapping),
  inputFieldRoots: longhaulInputFieldRoots,
  deriveFacts: deriveLonghaulFacts,
  factCatalog: longhaulFactCatalog,
  rules: longhaulRules,
  defaultAction: 'save',
}

const REGISTRY: Record<string, IntegrationDefinition> = {
  longhaul: longhaulDefinition,
}

export function getIntegrationDefinition(id: string): IntegrationDefinition | undefined {
  return REGISTRY[id]
}

export function listIntegrationIds(): string[] {
  return Object.keys(REGISTRY)
}
