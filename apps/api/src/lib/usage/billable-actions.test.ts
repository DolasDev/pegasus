import { describe, it, expect } from 'vitest'
import { Actions } from '../../authz/actions'
import { BILLABLE_ACTIONS, isBillableActionId, workflowIdFromClientName } from './billable-actions'

describe('BILLABLE_ACTIONS', () => {
  it('every key is a real Actions id', () => {
    const ids = new Set(Object.values(Actions).map((a) => a.id))
    for (const key of Object.keys(BILLABLE_ACTIONS)) expect(ids).toContain(key)
  })

  it('meters exactly the outward-reaching mutations that exist today', () => {
    // A change to this list is a pricing change: the published "what counts"
    // list (SDK README, company site, NW proposal) must move with it.
    expect(Object.keys(BILLABLE_ACTIONS).sort()).toEqual([
      'CallExternal',
      'CloseTask',
      'DeliverToExternal',
      'SendEmail',
      'SendSms',
      'UpdateTextMessage',
    ])
  })

  it('does not treat inherited properties as registry entries', () => {
    expect(isBillableActionId('toString')).toBe(false)
    expect(isBillableActionId('EmitTenantEvent')).toBe(false)
  })
})

describe('workflowIdFromClientName', () => {
  it('reads the workflow id off a runtime client name', () => {
    expect(workflowIdFromClientName('wf-runtime-abc-123')).toBe('abc-123')
  })
  it.each(['acme-erp', 'wf-runtime-', 'xwf-runtime-1', ''])(
    '%j is not a runtime client',
    (name) => {
      expect(workflowIdFromClientName(name)).toBeNull()
    },
  )
})
