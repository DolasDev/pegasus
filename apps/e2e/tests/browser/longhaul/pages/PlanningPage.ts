import type { Page, Locator } from '@playwright/test'

// ---------------------------------------------------------------------------
// PlanningPage — /driver-planning/planning (the legacy trip-builder).
// Source: apps/tenant-web/src/features/driver-planning/routes/PlanningModule.tsx
//   → .PlanningModule__container > .App__left-column (SearchDashboard) +
//     .App__right-column (PendingTrips) + <ShipmentDetail/>.
//   The unsaved-changes guard is a ConfirmDialog: title "Leave page?",
//   description "You have unsaved changes...", confirm "Discard changes",
//   cancel "Stay on page".
//
// Selectors target the `data-target` hooks added to the ported components
// (see the `test(tenant-web): add data-target hooks…` commit) — they don't
// depend on hashed CSS-module class names.
// ---------------------------------------------------------------------------

export class PlanningPage {
  constructor(
    readonly page: Page,
    readonly webUrl: string,
  ) {}

  get container(): Locator {
    return this.page.locator('.PlanningModule__container')
  }
  get leftColumn(): Locator {
    return this.page.locator('.App__left-column')
  }
  get rightColumn(): Locator {
    return this.page.locator('.App__right-column')
  }
  /** The SearchDashboard pane (left). */
  get searchDashboard(): Locator {
    return this.page.locator('[data-target="search-dashboard"]')
  }
  /** The PendingTrips pane (right). */
  get pendingTrips(): Locator {
    return this.page.locator('[data-target="pending-trips"]')
  }
  /** "No shipments for trip" empty state in the pending-trip pane. */
  get emptyPendingTrip(): Locator {
    return this.pendingTrips.getByText(/no shipments for trip/i)
  }

  get saveButton(): Locator {
    return this.pendingTrips.locator('[data-target="save-trip"]')
  }
  get newTripButton(): Locator {
    return this.pendingTrips.locator('[data-target="pending-new-trip"]')
  }
  /** Trip-title input — rendered by NameTripDetail's edit component. */
  get tripNameInput(): Locator {
    return this.pendingTrips.locator('[data-target="trip-name-input"]')
  }
  /** DriverTypeahead wrapper; `.locator('input')` for the actual <input>. */
  get driverTypeahead(): Locator {
    return this.pendingTrips.locator('[data-target="driver-typeahead"]')
  }
  get driverTypeaheadInput(): Locator {
    return this.driverTypeahead.locator('input')
  }
  get viewItineraryLink(): Locator {
    return this.pendingTrips.locator('[data-target="view-itinerary"]')
  }
  get moreTripActions(): Locator {
    return this.pendingTrips.locator('[data-target="more-trip-actions"]')
  }
  get cancelTripMenuItem(): Locator {
    return this.page.locator('[data-target="cancel-trip"]')
  }

  /** Shipment cards in the SearchDashboard (left pane). */
  shipmentCards(): Locator {
    return this.searchDashboard.locator('[data-target="shipment-card"]')
  }
  shipmentCardByOrderNum(orderNum: string | number): Locator {
    return this.searchDashboard.locator(
      `[data-target="shipment-card"][data-order-num="${orderNum}"]`,
    )
  }
  /** The "+" add-to-trip control on a shipment card. */
  addToTripButton(card: Locator): Locator {
    return card.locator('[data-target="add-shipment-to-trip"]')
  }

  /** Shipment cards currently in the pending trip (right pane). */
  pendingTripShipments(): Locator {
    return this.pendingTrips.locator('[data-target="pending-trip-shipment"]')
  }
  /** Activity rows within a pending-trip shipment card. */
  pendingActivities(card?: Locator): Locator {
    return (card ?? this.pendingTrips).locator('[data-target="trip-activity"]')
  }
  /** "+" add-activity control within a pending-trip shipment card. */
  addActivityButton(card: Locator): Locator {
    return card.locator('[data-target="add-activity"]')
  }
  addActivityOptions(): Locator {
    return this.page.locator('[data-target="add-activity-option"]')
  }

  // -- unsaved-changes guard -------------------------------------------------
  get leavePageDialog(): Locator {
    return this.page.getByText('Leave page?')
  }
  get discardChangesButton(): Locator {
    return this.page.getByRole('button', { name: 'Discard changes' })
  }
  get stayOnPageButton(): Locator {
    return this.page.getByRole('button', { name: 'Stay on page' })
  }

  // -- snackbar (save feedback) ---------------------------------------------
  get snackbar(): Locator {
    return this.page.locator('[data-target="snackbar"]')
  }

  async addFirstShipmentToTrip(): Promise<string> {
    const card = this.shipmentCards().first()
    await card.waitFor({ state: 'visible' })
    const orderNum = (await card.getAttribute('data-order-num')) ?? ''
    await this.addToTripButton(card).click()
    return orderNum
  }

  async openWithTripId(tripId: string | number): Promise<void> {
    await this.page.goto(`${this.webUrl}/driver-planning/planning?tripId=${tripId}`, {
      waitUntil: 'domcontentloaded',
    })
  }
}
