import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

vi.mock('./support/triage', () => ({ runTriage: vi.fn() }))

import { runTriage } from './support/triage'
import { handler } from './lambda-support-triage'

const run = runTriage as unknown as Mock

beforeEach(() => run.mockReset())

describe('support triage worker', () => {
  it('runs the draft named in the event', async () => {
    run.mockResolvedValue('ready')
    expect(await handler({ draftId: 'd1' })).toEqual({ status: 'ready' })
    expect(run).toHaveBeenCalledWith('d1')
  })

  it('reports a draft that was not its to run (already claimed) as skipped', async () => {
    run.mockResolvedValue(null)
    expect(await handler({ draftId: 'd1' })).toEqual({ status: 'skipped' })
  })

  it('rejects a malformed event without running anything (and without throwing: no retries)', async () => {
    expect(await handler({ nope: true })).toEqual({ status: 'bad_event' })
    expect(run).not.toHaveBeenCalled()
  })
})
