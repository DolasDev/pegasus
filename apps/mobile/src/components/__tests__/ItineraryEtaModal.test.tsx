import { shiftTime } from '../ItineraryEtaModal'

describe('shiftTime', () => {
  it('steps HH:mm and stays within one day', () => {
    expect(shiftTime('08:00', 30)).toBe('08:30')
    expect(shiftTime('08:30', -30)).toBe('08:00')
    expect(shiftTime('00:00', -30)).toBe('00:00')
    expect(shiftTime('23:30', 30)).toBe('23:30')
  })
})
