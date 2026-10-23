/**
 * Shapes of the `/api/v1/labor` responses (apps/api/src/handlers/labor.ts).
 *
 * A crew is keyed by its E.164 phone number. Name, email, service areas and
 * packers are shared by every driver who has the number in their list; the
 * nickname and the rating are the caller's own.
 */

export interface LaborServiceArea {
  id: string
  city: string
  region: string
  country: 'US' | 'CA'
  /** False when the city wasn't in the place list — it then can't rank by distance. */
  geocoded: boolean
}

export interface LaborRating {
  stars: number
  comment: string | null
  updatedAt: string
}

/** Anonymous average across every driver's rating; null under 3 raters. */
export interface LaborAverageRating {
  average: number
  count: number
}

export interface LaborCrew {
  phone: string
  phoneDisplay: string
  name: string
  nickname: string | null
  displayName: string
  email: string | null
  serviceAreas: LaborServiceArea[]
  packerCount: number
  myRating: LaborRating | null
  averageRating: LaborAverageRating | null
  addedAt: string
  /** Present on location searches; null when the crew has no geocoded area. */
  distanceMiles?: number | null
}

export interface LaborPacker {
  id: string
  firstName: string
  lastName: string
  email: string | null
  cidNumber: string | null
  /** `YYYY-MM-DD` */
  cidIssuedOn: string | null
  phone: string | null
  phoneDisplay: string | null
  updatedAt: string
}

export interface LaborCrewDetail extends LaborCrew {
  packers: LaborPacker[]
}

export interface LaborSearchLocation {
  lat: number
  lon: number
  label: string
}

export interface LaborSearchResult {
  crews: LaborCrew[]
  /** Where a location search was centred; null for A–Z results. */
  location: LaborSearchLocation | null
  /** The ZIP / postal code / "City, ST" wasn't one we know. */
  locationNotFound: boolean
}

export type LaborAddOutcome = 'added' | 'linkedExisting' | 'alreadyInList'

export type LaborImportOutcome = LaborAddOutcome | 'invalid' | 'rateLimited'

export interface LaborImportResult {
  phone: string
  outcome: LaborImportOutcome
  code?: string
  error?: string
}

export interface LaborPlace {
  city: string
  region: string
  country: 'US' | 'CA'
}

export interface LaborPackerInput {
  firstName: string
  lastName: string
  email?: string | null
  cidNumber?: string | null
  cidIssuedOn?: string | null
  phone?: string | null
}

/** A packer on a crew assigned to an activity; `selected` = worked it. */
export interface LaborActivityPacker {
  id: string
  firstName: string
  lastName: string
  phoneDisplay: string | null
  selected: boolean
}

/** A crew assigned to an activity, with ALL its packers. */
export interface LaborActivityCrew {
  phone: string
  phoneDisplay: string
  name: string
  nickname: string | null
  displayName: string
  /** False once I've removed the crew from my list — it stays on the activity. */
  inMyBook: boolean
  packers: LaborActivityPacker[]
}

/** A legacy longhaul activity on an order, with its labor (GET /labor/orders/:n/activities). */
export interface LaborActivity {
  id: number
  orderNum: number
  typeCode: string | null
  typeName: string | null
  typeAbbreviation: string | null
  plannedStart: string | null
  estimatedDate: string | null
  actualDate: string | null
  /** True when I'm the activity's driver. */
  editable: boolean
  crews: LaborActivityCrew[]
}

/** One crew in a PUT /labor/activities/:id body. */
export interface LaborActivityCrewInput {
  phone: string
  packerIds: string[]
}
