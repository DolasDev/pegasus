import type { Page, Locator } from '@playwright/test'

// ---------------------------------------------------------------------------
// TripsPage — /driver-planning/trips
// Source: apps/tenant-web/src/features/driver-planning/routes/TripsModule.tsx
//   → .TripsModule__container > <Trips/>.
// Trips: apps/tenant-web/src/features/driver-planning/containers/Trips/index.tsx
//   → <Lane title={`Trips (${n})`}>  (Lane renders the title in an <h5>),
//     <Link to="/planning"><Button>New Trip</Button></Link>  (real <button>),
//     <TripsFilter/>, list of <TripCard/>, and a "No trips found" <h3> empty state.
// TripCard: containers/Trips/components/TripCard/index.tsx → an <a> whose href is
//   the router-compat-translated path  /driver-planning/trips/<id>  (legacy
//   `to="/trip/<id>"`), with heading text  "Trip <id> | <title> | <driver|Unassigned>"
//   (+ " - CANCELED" when internal_status === 'canceled') and a status pill
//   ("pending" / "accepted" / "offered" / "in-progress" / ...).
//
// NOTE: still confirm against the running app in Phase A.
// ---------------------------------------------------------------------------

export class TripsPage {
  constructor(readonly page: Page) {}

  /** "Trips (n)" lane title (an <h5>). */
  get laneTitle(): Locator {
    return this.page.getByRole('heading', { name: /^Trips \(\d+\)$/ })
  }
  get newTripButton(): Locator {
    return this.page.getByRole('button', { name: 'New Trip' })
  }
  get emptyState(): Locator {
    return this.page.getByRole('heading', { name: 'No trips found' })
  }
  /** All trip-card links (`/driver-planning/trips/<id>`) — excludes the "Trips" tab link. */
  get cards(): Locator {
    return this.page.locator('a[href*="/driver-planning/trips/"]')
  }

  cardByTripId(tripId: string | number): Locator {
    return this.page.locator(`a[href$="/driver-planning/trips/${tripId}"]`)
  }

  async cardCount(): Promise<number> {
    return this.cards.count()
  }

  async openTrip(tripId: string | number): Promise<void> {
    await this.cardByTripId(tripId).first().click()
  }
}
