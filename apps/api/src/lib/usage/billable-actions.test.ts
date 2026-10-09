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
      'WriteOrder',
    ])
  })

  it('does not treat inherited properties as registry entries', () => {
    expect(isBillableActionId('toString')).toBe(false)
    expect(isBillableActionId('EmitTenantEvent')).toBe(false)
  })

  describe('WriteOrder', () => {
    // `data` is the native order, so the outcome is read off the header the route sets.
    const ctx = (applied: string | null) =>
      ({
        res: new Response('{}', {
          headers: applied === null ? {} : { 'x-pegasus-applied': applied },
        }),
      }) as unknown as Parameters<(typeof BILLABLE_ACTIONS)['WriteOrder']['billable']>[1]

    it('bills an applied write, once per write', async () => {
      expect(await BILLABLE_ACTIONS.WriteOrder.billable({ Id: 1 }, ctx('true'))).toBe(true)
      const a = BILLABLE_ACTIONS.WriteOrder.subjectKey()
      const b = BILLABLE_ACTIONS.WriteOrder.subjectKey()
      expect(a).toMatch(/^order-write:/)
      expect(a).not.toBe(b)
    })

    it.each([['false'], [null]])(
      'does not bill when applied is %j (an unchanged replay)',
      async (h) => {
        expect(await BILLABLE_ACTIONS.WriteOrder.billable({ Id: 1 }, ctx(h))).toBe(false)
      },
    )
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
