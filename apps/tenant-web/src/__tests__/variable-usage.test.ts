// ---------------------------------------------------------------------------
// Unit tests for the variable ↔ consumer cross-reference. Pure transform, so no
// mocking beyond hand-built summary payloads.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import {
  buildVariableUsageIndex,
  consumersOf,
  missingVariables,
  usageKey,
} from '../features/settings/variable-usage'
import type { WorkflowRequirementsSummary } from '../api/workflows'
import type { IntegrationRequirementsSummary } from '../api/integrations'

type Req = WorkflowRequirementsSummary['workflows'][number]['requirements'][number]

function secret(key: string, over: Partial<Req> = {}): Req {
  return { kind: 'SECRET', key, group: 'global', description: null, present: false, ...over }
}

function config(key: string, over: Partial<Req> = {}): Req {
  return { kind: 'CONFIG', key, group: 'global', description: null, present: false, ...over }
}

function workflows(
  ...rows: Array<{ id: string; name: string; requirements: Req[] }>
): WorkflowRequirementsSummary {
  return {
    workflows: rows.map((r) => ({
      workflowId: r.id,
      name: r.name,
      version: '1.0.0',
      visibility: 'TENANT' as const,
      requirements: r.requirements,
      missingCount: r.requirements.filter((x) => !x.present).length,
    })),
    totalMissing: 0,
  }
}

function integrations(
  ...rows: Array<{ id: string; name: string; requirements: Req[] }>
): IntegrationRequirementsSummary {
  return {
    integrations: rows.map((r) => ({
      integrationId: r.id,
      displayName: r.name,
      requirements: r.requirements,
      missingCount: r.requirements.filter((x) => !x.present).length,
    })),
    totalMissing: 0,
  }
}

describe('buildVariableUsageIndex', () => {
  it('collects workflow and integration consumers under one key', () => {
    const index = buildVariableUsageIndex(
      workflows({ id: 'wf1', name: 'nightly-sync', requirements: [secret('STRIPE_API_KEY')] }),
      integrations({ id: 'sirva', name: 'Sirva ADE', requirements: [secret('STRIPE_API_KEY')] }),
    )

    expect(consumersOf(index, 'SECRET', 'global', 'STRIPE_API_KEY')).toEqual([
      { type: 'workflow', id: 'wf1', name: 'nightly-sync' },
      { type: 'integration', id: 'sirva', name: 'Sirva ADE' },
    ])
  })

  it('dedupes a workflow that appears once per published version', () => {
    // listForTenant returns EVERY version as its own row with its own id — an
    // id-based dedupe would render the same workflow three times.
    const index = buildVariableUsageIndex(
      workflows(
        { id: 'wf-v1', name: 'nightly-sync', requirements: [secret('STRIPE_API_KEY')] },
        { id: 'wf-v2', name: 'nightly-sync', requirements: [secret('STRIPE_API_KEY')] },
        { id: 'wf-v3', name: 'nightly-sync', requirements: [secret('STRIPE_API_KEY')] },
      ),
    )

    const consumers = consumersOf(index, 'SECRET', 'global', 'STRIPE_API_KEY')
    expect(consumers).toHaveLength(1)
    // First id seen wins as the link target.
    expect(consumers[0]).toEqual({ type: 'workflow', id: 'wf-v1', name: 'nightly-sync' })
  })

  it('keeps a workflow and an integration that share a name apart', () => {
    const index = buildVariableUsageIndex(
      workflows({ id: 'wf1', name: 'sirva', requirements: [config('REGION')] }),
      integrations({ id: 'intg1', name: 'sirva', requirements: [config('REGION')] }),
    )

    expect(consumersOf(index, 'CONFIG', 'global', 'REGION')).toHaveLength(2)
  })

  it('does not conflate a SECRET and a CONFIG of the same name', () => {
    const index = buildVariableUsageIndex(
      workflows({
        id: 'wf1',
        name: 'a',
        requirements: [secret('API_KEY'), config('API_KEY')],
      }),
    )

    expect(index.size).toBe(2)
    expect(index.get(usageKey('SECRET', 'global', 'API_KEY'))?.kind).toBe('SECRET')
    expect(index.get(usageKey('CONFIG', 'global', 'API_KEY'))?.kind).toBe('CONFIG')
  })

  it('does not conflate the same key in different groups', () => {
    const index = buildVariableUsageIndex(
      workflows({
        id: 'wf1',
        name: 'a',
        requirements: [secret('API_KEY', { group: 'billing' }), secret('API_KEY')],
      }),
      integrations({
        id: 'i1',
        name: 'b',
        requirements: [secret('API_KEY', { group: 'billing' })],
      }),
    )

    expect(consumersOf(index, 'SECRET', 'billing', 'API_KEY')).toHaveLength(2)
    expect(consumersOf(index, 'SECRET', 'global', 'API_KEY')).toHaveLength(1)
  })

  it('adopts a description declared by a later consumer', () => {
    const index = buildVariableUsageIndex(
      workflows(
        { id: 'wf1', name: 'a', requirements: [secret('TOKEN')] },
        { id: 'wf2', name: 'b', requirements: [secret('TOKEN', { description: 'Vendor token' })] },
      ),
    )

    expect(index.get(usageKey('SECRET', 'global', 'TOKEN'))?.description).toBe('Vendor token')
  })

  it('returns an empty index when neither summary could be read', () => {
    expect(buildVariableUsageIndex(undefined, undefined).size).toBe(0)
    expect(consumersOf(buildVariableUsageIndex(), 'SECRET', 'global', 'ANY')).toEqual([])
  })

  it('builds a partial index when only one summary could be read', () => {
    const index = buildVariableUsageIndex(
      undefined,
      integrations({ id: 'i1', name: 'Sirva ADE', requirements: [config('BASE_URL')] }),
    )

    expect(consumersOf(index, 'CONFIG', 'global', 'BASE_URL')).toHaveLength(1)
  })
})

describe('missingVariables', () => {
  it('returns only unset keys, one entry per key regardless of consumer count', () => {
    const index = buildVariableUsageIndex(
      workflows(
        {
          id: 'wf1',
          name: 'a',
          requirements: [secret('MISSING_ONE'), config('SET_ONE', { present: true })],
        },
        { id: 'wf2', name: 'b', requirements: [secret('MISSING_ONE')] },
      ),
    )

    const missing = missingVariables(index)
    expect(missing).toHaveLength(1)
    expect(missing[0]?.key).toBe('MISSING_ONE')
    expect(missing[0]?.consumers.map((c) => c.name)).toEqual(['a', 'b'])
  })

  it('sorts secrets first, then by group, then by key', () => {
    const index = buildVariableUsageIndex(
      workflows({
        id: 'wf1',
        name: 'a',
        requirements: [
          config('Z_CONFIG'),
          config('A_CONFIG'),
          secret('B_SECRET', { group: 'zeta' }),
          secret('C_SECRET', { group: 'alpha' }),
        ],
      }),
    )

    expect(missingVariables(index).map((v) => `${v.kind}:${v.group}:${v.key}`)).toEqual([
      'SECRET:alpha:C_SECRET',
      'SECRET:zeta:B_SECRET',
      'CONFIG:global:A_CONFIG',
      'CONFIG:global:Z_CONFIG',
    ])
  })

  it('is empty when everything is set', () => {
    const index = buildVariableUsageIndex(
      workflows({ id: 'wf1', name: 'a', requirements: [secret('OK', { present: true })] }),
    )

    expect(missingVariables(index)).toEqual([])
  })
})
