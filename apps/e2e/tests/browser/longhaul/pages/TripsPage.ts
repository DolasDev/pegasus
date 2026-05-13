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

  /** The `data-trip-id` of every currently-rendered trip card. */
  async cardTripIds(): Promise<string[]> {
    return (
      await this.cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-trip-id') ?? ''))
    ).filter(Boolean)
  }

  async openTrip(tripId: string | number): Promise<void> {
    await this.cardLink(tripId).first().click()
  }

  // -- TripsFilter (data-target hooks added to the ported component) ---------
  get filter(): Locator {
    return this.page.locator('[data-target="trips-filter"]')
  }
  /** A TripsFilter row by its query-key (e.g. "id", "TripStatus_id"). */
  filterRow(property: string): Locator {
    return this.page.locator(`[data-target="trip-filter-row"][data-filter="${property}"]`)
  }
  get clearFiltersLink(): Locator {
    return this.page.locator('[data-target="clear-trip-filters"]')
  }
  /** The plain text `<input>` of the "Trip Id" filter row. */
  get tripIdInput(): Locator {
    return this.filterRow('id').locator('input')
  }

  /**
   * Pick the first option offered by a react-select TripsFilter row (e.g. the
   * "TripStatus_id" status dropdown): focus its input to open the menu, then
   * click the first `.rs__option` (from `classNamePrefix="rs"` on `Select`).
   * Returns the picked option's label. Throws if the menu has no options.
   */
  async pickFirstFilterOption(property: string): Promise<string> {
    const row = this.filterRow(property)
    await row.locator('input').first().click()
    const option = row.locator('.rs__option').first()
    await option.waitFor({ state: 'visible', timeout: 10_000 })
    const label = (await option.innerText()).trim()
    await option.click()
    return label
  }
}
