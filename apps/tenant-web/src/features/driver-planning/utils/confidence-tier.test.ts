import { describe, expect, it } from 'vitest'
import type { Delivery } from '@/api/queries/driver-planning'
import { CONFIRMED_AVAILABILITY_TIER, NO_CONFIDENCE, getConfidenceTier } from './confidence-tier'

function activity(overrides?: Partial<Delivery>): Delivery {
  return {
    activityId: 1,
    plannedStart: '2026-06-01',
    plannedEnd: '2026-06-03',
    estimatedDate: '2026-06-02',
    actualDate: null,
    isCommitted: false,
    isConfirmed: false,
    city: 'DALLAS',
    state: 'TX',
    ...overrides,
  }
}

describe('getConfidenceTier', () => {
  it('ranks an actualized date highest — truck, deepest emerald', () => {
    const tier = getConfidenceTier(activity({ actualDate: '2026-06-15' }))
    expect(tier.icon).toBe('fa-truck-moving')
    expect(tier.colorClass).toBe('text-emerald-700')
    expect(tier.label).toBe('Verified complete')
  })

  it('ranks a driver-confirmed date next — checkered flag', () => {
    const tier = getConfidenceTier(activity({ isConfirmed: true }))
    expect(tier.icon).toBe('fa-flag-checkered')
    expect(tier.colorClass).toBe('text-emerald-600')
  })

  it('ranks a committed-only date below confirmed — check', () => {
    const tier = getConfidenceTier(activity({ isCommitted: true }))
    expect(tier.icon).toBe('fa-check')
    expect(tier.colorClass).toBe('text-emerald-500')
  })

  it('prefers the stronger signal when several are set', () => {
    expect(
      getConfidenceTier(
        activity({ actualDate: '2026-06-15', isConfirmed: true, isCommitted: true }),
      ).icon,
    ).toBe('fa-truck-moving')
    expect(getConfidenceTier(activity({ isConfirmed: true, isCommitted: true })).icon).toBe(
      'fa-flag-checkered',
    )
  })

  it('marks a planned-spread-only date as least certain — muted question mark', () => {
    const tier = getConfidenceTier(activity({ estimatedDate: null }))
    expect(tier.icon).toBe('fa-question')
    expect(tier.colorClass).toBe('text-muted-foreground')
  })

  it('treats a planned END with no start as a spread too', () => {
    // The Ready Date guess falls back to plannedEnd ?? plannedStart, so a row
    // carrying only an end date must still read as a spread, not as no signal.
    expect(getConfidenceTier(activity({ estimatedDate: null, plannedStart: null })).icon).toBe(
      'fa-question',
    )
  })

  it('gives a bare ETA no icon — an uncommitted estimate is not a signal', () => {
    expect(getConfidenceTier(activity())).toEqual(NO_CONFIDENCE)
  })

  it('gives a date-less activity no icon', () => {
    expect(
      getConfidenceTier(activity({ estimatedDate: null, plannedStart: null, plannedEnd: null })),
    ).toEqual(NO_CONFIDENCE)
  })

  it('keeps the planner-entered availability glyph out of the activity ladder', () => {
    // Nothing an activity can be should ever produce the calendar glyph — it is
    // reserved for a date a human typed into the roster.
    const activityIcons = [
      getConfidenceTier(activity({ actualDate: '2026-06-15' })).icon,
      getConfidenceTier(activity({ isConfirmed: true })).icon,
      getConfidenceTier(activity({ isCommitted: true })).icon,
      getConfidenceTier(activity({ estimatedDate: null })).icon,
    ]
    expect(activityIcons).not.toContain(CONFIRMED_AVAILABILITY_TIER.icon)
    expect(CONFIRMED_AVAILABILITY_TIER.icon).toBe('fa-calendar-check')
  })
})
