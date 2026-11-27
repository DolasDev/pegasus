import { describe, it, expect } from 'vitest'
import {
  SUPPORT_DRAFT_STATUSES,
  SUPPORT_WORK_ITEM_KINDS,
  SUPPORT_SEVERITIES,
  TRIAGE_STALE_AFTER_MS,
  effectiveDraftStatus,
  isSupportDraftStatus,
  isDraftInFlight,
  redactContactDetails,
} from '../index'

describe('support triage vocabularies', () => {
  it('lists the draft statuses, kinds and severities the migration CHECKs mirror', () => {
    expect(SUPPORT_DRAFT_STATUSES).toEqual(['pending', 'running', 'ready', 'failed', 'dismissed'])
    expect(SUPPORT_WORK_ITEM_KINDS).toEqual(['bug', 'investigation', 'feature', 'question'])
    expect(SUPPORT_SEVERITIES).toEqual(['low', 'medium', 'high'])
  })

  it('isSupportDraftStatus accepts only the listed statuses', () => {
    expect(isSupportDraftStatus('ready')).toBe(true)
    expect(isSupportDraftStatus('approved')).toBe(false)
    expect(isSupportDraftStatus(3)).toBe(false)
  })
})

describe('effectiveDraftStatus', () => {
  const created = new Date('2026-11-25T10:00:00Z')
  const at = (ms: number) => new Date(created.getTime() + ms)

  it('keeps a fresh pending or running draft as is', () => {
    expect(effectiveDraftStatus('pending', created, at(1000))).toBe('pending')
    expect(effectiveDraftStatus('running', created, at(TRIAGE_STALE_AFTER_MS - 1))).toBe('running')
  })

  it('reads a pending or running draft past the window as failed (a lost invoke)', () => {
    expect(effectiveDraftStatus('pending', created, at(TRIAGE_STALE_AFTER_MS))).toBe('failed')
    expect(effectiveDraftStatus('running', created, at(TRIAGE_STALE_AFTER_MS + 1))).toBe('failed')
  })

  it('never changes a settled draft', () => {
    for (const s of ['ready', 'failed', 'dismissed'] as const) {
      expect(effectiveDraftStatus(s, created, at(TRIAGE_STALE_AFTER_MS * 10))).toBe(s)
    }
  })

  it('isDraftInFlight is true only for a fresh pending/running draft', () => {
    expect(isDraftInFlight('pending', created, at(1))).toBe(true)
    expect(isDraftInFlight('running', created, at(TRIAGE_STALE_AFTER_MS))).toBe(false)
    expect(isDraftInFlight('ready', created, at(1))).toBe(false)
  })
})

describe('redactContactDetails', () => {
  it('replaces email addresses', () => {
    expect(redactContactDetails('Write to ann.lee+x@acme-moving.example please')).toBe(
      'Write to [email] please',
    )
  })

  it('replaces an email at the start, in brackets, and back to back', () => {
    expect(redactContactDetails('ann@a.example, (bob@b.example)')).toBe('[email], ([email])')
  })

  it('stays linear on a long run of local-part characters with no @', () => {
    const s = '%'.repeat(200_000)
    const t0 = Date.now()
    expect(redactContactDetails(s)).toBe(s)
    expect(Date.now() - t0).toBeLessThan(500)
  })

  it('replaces phone numbers in common formats', () => {
    expect(redactContactDetails('call 555-867-5309 or (312) 555 0147 or +1 312.555.0147')).toBe(
      'call [phone] or [phone] or [phone]',
    )
  })

  it('redacts a number at the very start, and back-to-back numbers', () => {
    expect(redactContactDetails('312-555-0147, 312-555-0148')).toBe('[phone], [phone]')
  })

  it('leaves order numbers, trip numbers and dates alone', () => {
    const s = 'Order 1234567 on trip 42, loaded 2026-11-24, weight 12,500 lbs'
    expect(redactContactDetails(s)).toBe(s)
  })
})
