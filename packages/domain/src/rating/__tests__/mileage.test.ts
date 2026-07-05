import { describe, it, expect } from 'vitest'
import { haversineMiles, createZip3CentroidEstimator, DEFAULT_ROAD_FACTOR } from '../mileage'

// Real ZIP3 centroids from the committed data table (NYC, LA, Chicago,
// Houston — see ../data/zip3-centroids.ts). Expected ranges below were
// computed independently in Python from these same lat/lon pairs, so this
// is checking the module's arithmetic, not re-deriving its own fixture.
const NYC_ZIP = '10001'
const LA_ZIP = '90001'
const CHICAGO_ZIP = '60601'
const HOUSTON_ZIP = '77001'
const UNKNOWN_ZIP = '00000'

describe('haversineMiles', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineMiles(40, -74, 40, -74)).toBeCloseTo(0, 5)
  })

  it('computes the known NYC-LA straight-line distance (~2451 mi)', () => {
    const miles = haversineMiles(40.778, -73.9669, 34.0438, -118.3137)
    expect(miles).toBeGreaterThan(2400)
    expect(miles).toBeLessThan(2500)
  })

  it('is symmetric', () => {
    const ab = haversineMiles(40.778, -73.9669, 34.0438, -118.3137)
    const ba = haversineMiles(34.0438, -118.3137, 40.778, -73.9669)
    expect(ab).toBeCloseTo(ba, 6)
  })
})

describe('createZip3CentroidEstimator', () => {
  it('estimates NYC -> LA within a plausible driving-distance range', () => {
    const estimator = createZip3CentroidEstimator()
    const result = estimator.estimate(NYC_ZIP, LA_ZIP)
    expect(result).toBeDefined()
    expect(result?.method).toBe('ZIP3_CENTROID_HAVERSINE')
    expect(result?.approximate).toBe(true)
    // Straight-line ~2451mi x 1.17 road factor ~2868mi; actual road distance
    // is ~2790mi — this estimator is approximate by design, so assert a
    // generous bound rather than an exact match.
    expect(result?.miles).toBeGreaterThan(2000)
    expect(result?.miles).toBeLessThan(3200)
  })

  it('estimates a known shorter leg (Chicago -> Houston) smaller than NYC -> LA', () => {
    const estimator = createZip3CentroidEstimator()
    const chiHou = estimator.estimate(CHICAGO_ZIP, HOUSTON_ZIP)
    const nycLa = estimator.estimate(NYC_ZIP, LA_ZIP)
    expect(chiHou?.miles).toBeLessThan(nycLa!.miles)
    expect(chiHou?.miles).toBeGreaterThan(800)
    expect(chiHou?.miles).toBeLessThan(1300)
  })

  it('returns ~0 miles for identical origin and destination zip3', () => {
    const estimator = createZip3CentroidEstimator()
    const result = estimator.estimate(NYC_ZIP, '10099')
    expect(result?.miles).toBeCloseTo(0, 0)
  })

  it('returns undefined when the origin zip3 is unknown', () => {
    const estimator = createZip3CentroidEstimator()
    expect(estimator.estimate(UNKNOWN_ZIP, LA_ZIP)).toBeUndefined()
  })

  it('returns undefined when the destination zip3 is unknown', () => {
    const estimator = createZip3CentroidEstimator()
    expect(estimator.estimate(NYC_ZIP, UNKNOWN_ZIP)).toBeUndefined()
  })

  it('returns undefined for a malformed zip (too short)', () => {
    const estimator = createZip3CentroidEstimator()
    expect(estimator.estimate('1', LA_ZIP)).toBeUndefined()
  })

  it('applies a custom road factor', () => {
    const base = createZip3CentroidEstimator(1.0).estimate(NYC_ZIP, LA_ZIP)
    const inflated = createZip3CentroidEstimator(2.0).estimate(NYC_ZIP, LA_ZIP)
    expect(inflated!.miles).toBeCloseTo(base!.miles * 2, 0)
  })

  it('defaults to DEFAULT_ROAD_FACTOR when no factor is supplied', () => {
    const withDefault = createZip3CentroidEstimator().estimate(NYC_ZIP, LA_ZIP)
    const explicit = createZip3CentroidEstimator(DEFAULT_ROAD_FACTOR).estimate(NYC_ZIP, LA_ZIP)
    expect(withDefault).toEqual(explicit)
  })
})
