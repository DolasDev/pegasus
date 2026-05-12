import type { Page, Locator } from '@playwright/test'

// ---------------------------------------------------------------------------
// TripsPage — /driver-planning/trips
// Source: apps/tenant-web/src/features/driver-planning/routes/TripsModule.tsx
//   → .TripsModule__container > <Trips/>.
// Trips: apps/tenant-web/src/features/driver-planning/containers/Trips/index.tsx
//   → <Lane title={`Trips (${n})`}>, <Link to="/planning"><Button>New Trip</Button></Link>,
//     <TripsFilter/>, list of <TripCard/> (clickable → /trip/:id), and the
//     "No trips found / Please revise your search" empty state.
//
// NOTE: locators derived from source; confirm in Phase A.
// ---------------------------------------------------------------------------

export class TripsPage {
  constructor(readonly page: Page) {}

  /** "Trips (n)" lane title. */
  get laneTitle(): Locator {
    return this.page.getByText(/^Trips \(\d+\)$/)
  }
  get newTripButton(): Locator {
    return this.page.getByRole('button', { name: 'New Trip' })
  }
  get emptyState(): Locator {
    return this.page.getByText('No trips found')
  }
  get cards(): Locator {
    // TripCard — TODO Phase A: confirm a stable selector / add data-testid.
    return this.page.locator('[class*="TripCard"], a[href*="/trip/"]')
  }

  cardByTripId(tripId: string | number): Locator {
    return this.page.locator(`a[href$="/trip/${tripId}"], a[href*="/trips/${tripId}"]`)
  }

  async cardCount(): Promise<number> {
    return this.cards.count()
  }

  async openTrip(tripId: string | number): Promise<void> {
    await this.cardByTripId(tripId).first().click()
  }
}
