import { describe, expect, it } from 'vitest'
import { isRedirect } from '@tanstack/react-router'

import {
  redirectLegacyWorkflowDetail,
  redirectLegacyWorkflowsList,
  validateAutomationDetailSearch,
} from './legacy-workflow-redirects'

function thrown(fn: () => unknown): unknown {
  try {
    fn()
  } catch (err) {
    return err
  }
  throw new Error('expected the handler to throw a redirect')
}

describe('legacy /settings/workflows redirects', () => {
  it('sends the old list path to /settings/automations, replacing history', () => {
    const err = thrown(() => redirectLegacyWorkflowsList())
    expect(isRedirect(err)).toBe(true)
    expect((err as { options: unknown }).options).toMatchObject({
      to: '/settings/automations',
      replace: true,
    })
  })

  it('sends the old detail path to the same automation, keeping ?tab=executions', () => {
    const err = thrown(() =>
      redirectLegacyWorkflowDetail({
        params: { workflowId: 'wf-1' },
        search: { tab: 'executions' },
      }),
    )
    expect(isRedirect(err)).toBe(true)
    expect((err as { options: unknown }).options).toMatchObject({
      to: '/settings/automations/$workflowId',
      params: { workflowId: 'wf-1' },
      search: { tab: 'executions' },
      replace: true,
    })
  })
})

describe('validateAutomationDetailSearch', () => {
  it('keeps tab=executions', () => {
    expect(validateAutomationDetailSearch({ tab: 'executions' })).toEqual({ tab: 'executions' })
  })

  it('drops anything else', () => {
    expect(validateAutomationDetailSearch({ tab: 'bogus', other: 1 })).toEqual({})
  })
})
