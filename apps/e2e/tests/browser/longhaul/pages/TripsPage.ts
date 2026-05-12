import type { Page, Locator } from '@playwright/test'

// ---------------------------------------------------------------------------
// TripsPage — /driver-planning/trips
// Source: apps/tenant-web/src/features/driver-planning/routes/TripsModule.tsx
//   → .TripsModule__container > <Trips/>.
// Trips: containers/Trips/index.tsx → <Lane title={`Trips (${n})`}> (an <h5>),
//   <Link to="/planning"><Button>New Trip</Button></Link>, <TripsFilter/>,
//   list of <TripCard/>, and a "No trips found" <h3> empty state.
// TripCard: containers/Trips/components/TripCard/index.tsx → an <a href> wrapping
//   a Card with data-target="trip-card", data-trip-id, data-trip-status,
//   data-canceled. The <a>'s href is router-compat-translated to
//   /driver-planning/trips/<id>.
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
  /** All trip cards. */
  get cards(): Locator {
    return this.page.locator('[data-target="trip-card"]')
  }
  cardByTripId(tripId: string | number): Locator {
    return this.page.locator(`[data-target="trip-card"][data-trip-id="${tripId}"]`)
  }
  /** The <a> wrapping a given trip card (what you click to open the detail page). */
  cardLink(tripId: string | number): Locator {
    return this.page.locator(`a[href$="/driver-planning/trips/${tripId}"]`)
  }

  async cardCount(): Promise<number> {
    return this.cards.count()
  }

  /** The `data-trip-id` of the first rendered trip card, for use as a fixture id. */
  async firstTripId(): Promise<string | null> {
    if ((await this.cards.count()) === 0) return null
    return this.cards.first().getAttribute('data-trip-id')
  }

  async openTrip(tripId: string | number): Promise<void> {
    await this.cardLink(tripId).first().click()
  }
}
