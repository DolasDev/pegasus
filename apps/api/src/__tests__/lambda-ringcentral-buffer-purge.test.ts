// Unit tests for the RingCentral buffer-purge cron.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  purgeForwardedBodies: vi.fn(),
  hardDeleteForwarded: vi.fn(),
  purgeReceivedEventBodies: vi.fn(),
}))

vi.mock('../db', () => ({ db: {} }))
vi.mock('../repositories/messaging.repository', () => ({
  purgeForwardedBodies: h.purgeForwardedBodies,
  hardDeleteForwarded: h.hardDeleteForwarded,
  purgeReceivedEventBodies: h.purgeReceivedEventBodies,
}))

import { handler } from '../lambda-ringcentral-buffer-purge'

beforeEach(() => {
  for (const v of Object.values(h)) {
    if (typeof v === 'function' && 'mockReset' in v) (v as ReturnType<typeof vi.fn>).mockReset()
  }
  h.purgeForwardedBodies.mockResolvedValue(0)
  h.hardDeleteForwarded.mockResolvedValue(0)
  h.purgeReceivedEventBodies.mockResolvedValue(0)
})

describe('lambda-ringcentral-buffer-purge', () => {
  it('runs every retention step even when nothing is purgeable', async () => {
    await handler()
    expect(h.purgeForwardedBodies).toHaveBeenCalledTimes(1)
    expect(h.hardDeleteForwarded).toHaveBeenCalledTimes(1)
    expect(h.purgeReceivedEventBodies).toHaveBeenCalledTimes(1)
  })

  it('purges sms.received event bodies against a ~72h-old cutoff', async () => {
    await handler()
    const cutoff = h.purgeReceivedEventBodies.mock.calls[0]![1] as Date
    const hours = (Date.now() - cutoff.getTime()) / 3_600_000
    expect(hours).toBeGreaterThan(71.9)
    expect(hours).toBeLessThan(72.1)
  })

  it('hard-deletes against a ~30-day-old cutoff', async () => {
    await handler()
    const cutoff = h.hardDeleteForwarded.mock.calls[0]![1] as Date
    const ageMs = Date.now() - cutoff.getTime()
    const days = ageMs / (24 * 3_600_000)
    expect(days).toBeGreaterThan(29.9)
    expect(days).toBeLessThan(30.1)
  })

  it('completes without throwing when rows are purged', async () => {
    h.purgeForwardedBodies.mockResolvedValue(4)
    h.hardDeleteForwarded.mockResolvedValue(2)
    await expect(handler()).resolves.toBeUndefined()
  })
})
