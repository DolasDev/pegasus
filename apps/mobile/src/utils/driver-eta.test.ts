import {
  activityHasEta,
  arrivalWindowError,
  confirmAlertMessage,
  describeCommitment,
  etaActivityLabel,
  formatArrivalWindow,
  formatEtaDate,
  formatHhMm,
  isCommitted,
  isDriverEtaActivity,
  shiftDateOnly,
  shiftHhMm,
  toDateOnly,
} from './driver-eta'

describe('driver ETA activity selection', () => {
  it('accepts Delivery and SIT-IN by code, not abbreviation', () => {
    expect(isDriverEtaActivity({ id: 1, ActivityType_code: 'RDEL' })).toBe(true)
    expect(isDriverEtaActivity({ id: 1, activityType_code: 'SITIN' })).toBe(true)
    // SIT-OUT shares the `SIT` abbreviation with SIT-IN but is not a delivery.
    expect(
      isDriverEtaActivity({ id: 1, ActivityType_code: 'SITOUT', activityType_abbreviation: 'SIT' }),
    ).toBe(false)
    expect(isDriverEtaActivity({ id: 1, ActivityType_code: 'PACK' })).toBe(false)
  })

  it('labels SIT-IN as delivery to storage', () => {
    expect(etaActivityLabel({ id: 1, ActivityType_code: 'SITIN' })).toBe(
      'Delivery to Storage (SIT-IN)',
    )
    expect(etaActivityLabel({ id: 1, ActivityType_code: 'RDEL' })).toBe('Delivery')
  })

  it('reads isHasETA and is_committed bits', () => {
    expect(activityHasEta({ id: 1, activityType_isHasETA: 0 })).toBe(false)
    expect(activityHasEta({ id: 1, activityType_isHasETA: true })).toBe(true)
    expect(activityHasEta({ id: 1 })).toBe(true)
    expect(isCommitted({ id: 1, is_committed: 1 })).toBe(true)
    expect(isCommitted({ id: 1, is_committed: null })).toBe(false)
  })
})

describe('date + time arithmetic', () => {
  it('reads the calendar day off a midnight-UTC timestamp', () => {
    expect(toDateOnly('2026-11-02T00:00:00.000Z')).toBe('2026-11-02')
    expect(toDateOnly(null)).toBeNull()
  })

  it('shifts days across month boundaries without zone drift', () => {
    expect(shiftDateOnly('2026-10-31', 1)).toBe('2026-11-01')
    expect(shiftDateOnly('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('formats the ETA day in UTC', () => {
    expect(formatEtaDate('2026-11-02T00:00:00.000Z')).toBe('Mon, Nov 2, 2026')
  })

  it('steps and clamps times', () => {
    expect(shiftHhMm('08:00', 30)).toBe('08:30')
    expect(shiftHhMm('00:15', -30)).toBe('00:00')
    expect(shiftHhMm('23:45', 30)).toBe('23:59')
    expect(formatHhMm('00:00')).toBe('12:00 AM')
    expect(formatHhMm('13:30')).toBe('1:30 PM')
  })

  it('validates a window', () => {
    expect(arrivalWindowError('08:00', '10:00', 'America/Chicago')).toBeNull()
    expect(arrivalWindowError('10:00', '08:00', 'America/Chicago')).toMatch(/end after/)
    expect(arrivalWindowError('08:00', '10:00', null)).toMatch(/time zone/)
  })
})

describe('commitment wording', () => {
  it('states that BOTH the driver and the shipper committed', () => {
    const window = formatArrivalWindow('08:00', '10:00', 'America/Chicago')
    expect(window).toBe('8:00 AM – 10:00 AM Central')
    const msg = confirmAlertMessage(describeCommitment('2026-11-02', window))
    expect(msg).toContain('both you and the shipper have committed')
    expect(msg).toContain('on Mon, Nov 2, 2026 between 8:00 AM – 10:00 AM Central')
  })
})
