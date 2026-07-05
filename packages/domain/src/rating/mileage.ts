// ---------------------------------------------------------------------------
// Mileage estimation
//
// The rating engine needs an origin -> destination distance to price
// linehaul/shorthaul charges. The authoritative source for DP3 moves is
// DoD's DTOD system, which requires restricted per-tenant credentials we
// don't have. `createZip3CentroidEstimator` is a public-data fallback:
// straight-line (haversine) distance between the land-area-weighted
// centroids of the origin/destination ZIP3 prefixes, inflated by a fixed
// road-circuity factor. It is always flagged `approximate: true` in its
// output — callers must not present it as an official mileage figure.
//
// `MileageEstimator` is the seam a real source (DTOD, a commercial routing
// API) would implement later without touching any tariff rating code.
// ---------------------------------------------------------------------------

import { ZIP3_CENTROIDS } from './data/zip3-centroids'

const EARTH_RADIUS_MILES = 3958.8

/**
 * Average ratio of actual road distance to straight-line distance for
 * long-haul US trucking routes. 1.17 is a commonly cited rule-of-thumb
 * circuity factor; tunable per deployment if a better local calibration is
 * known.
 */
export const DEFAULT_ROAD_FACTOR = 1.17

export interface MileageEstimate {
  readonly miles: number
  readonly method: 'ZIP3_CENTROID_HAVERSINE'
  /** Always true for this estimator — flags the figure as non-authoritative. */
  readonly approximate: true
}

export interface MileageEstimator {
  /**
   * Estimates the distance between two ZIP codes (zip5 or zip3 accepted;
   * only the first 3 digits are used). Returns `undefined` when either ZIP
   * prefix has no known centroid.
   */
  estimate(originZip: string, destZip: string): MileageEstimate | undefined
}

/** Great-circle distance between two lat/lon points, in miles. */
export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(a)))
  return EARTH_RADIUS_MILES * c
}

function zip3Of(zip: string): string | undefined {
  const match = /^\d{3}/.exec(zip.trim())
  return match?.[0]
}

/**
 * Creates a `MileageEstimator` backed by the committed ZIP3 centroid table
 * (see data/zip3-centroids.ts — regenerate via
 * scripts/generate-zip3-centroids.ts).
 */
export function createZip3CentroidEstimator(
  roadFactor: number = DEFAULT_ROAD_FACTOR,
): MileageEstimator {
  return {
    estimate(originZip: string, destZip: string): MileageEstimate | undefined {
      const originZip3 = zip3Of(originZip)
      const destZip3 = zip3Of(destZip)
      if (!originZip3 || !destZip3) return undefined

      const origin = ZIP3_CENTROIDS[originZip3]
      const dest = ZIP3_CENTROIDS[destZip3]
      if (!origin || !dest) return undefined

      const straightLine = haversineMiles(origin[0], origin[1], dest[0], dest[1])
      return {
        miles: Math.round(straightLine * roadFactor * 10) / 10,
        method: 'ZIP3_CENTROID_HAVERSINE',
        approximate: true,
      }
    },
  }
}
