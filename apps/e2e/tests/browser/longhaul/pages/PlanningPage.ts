import type { Page, Locator } from '@playwright/test'

// ---------------------------------------------------------------------------
// PlanningPage — /driver-planning/planning (the legacy trip-builder).
// Source: apps/tenant-web/src/features/driver-planning/routes/PlanningModule.tsx
//   → .PlanningModule__container > .App__left-column (SearchDashboard) +
//     .App__right-column (PendingTrips) + <ShipmentDetail/>.
//   The unsaved-changes guard is a ConfirmDialog: title "Leave page?",
//   description "You have unsaved changes...", confirm "Discard changes",
//   cancel "Stay on page".
// PendingTrips: apps/tenant-web/src/features/driver-planning/containers/PendingTrips/index.tsx
//   → trip name InputField, DriverTypeahead, Dispatcher dropdown, "New Trip" /
//     "Save" buttons, AddActivity / EditActivity popovers, per-shipment Card +
//     activity rows, "Cancel Trip" in the More-actions (⋮) menu.
//
// NOTE: locators derived from source, to be confirmed in Phase A. Anything that
// can't be pinned down reliably yet is left as a TODO and the corresponding
// spec step is `test.fixme`'d.
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
  /** "No shipments for trip" empty state in the pending-trip pane. */
  get emptyPendingTrip(): Locator {
    return this.rightColumn.getByText(/no shipments for trip/i)
  }

  get saveButton(): Locator {
    return this.rightColumn.getByRole('button', { name: 'Save', exact: true })
  }
  get newTripButton(): Locator {
    return this.rightColumn.getByRole('button', { name: 'New Trip' })
  }
  get tripNameInput(): Locator {
    // InputField for trip title — TODO Phase A: confirm label/placeholder.
    return this.rightColumn.getByRole('textbox').first()
  }
  get driverTypeahead(): Locator {
    // DriverTypeahead — TODO Phase A: confirm the input selector.
    return this.rightColumn.getByPlaceholder(/driver/i)
  }
  get viewItineraryLink(): Locator {
    return this.rightColumn.getByRole('link', { name: /itinerary/i })
  }

  /** A shipment card inside the SearchDashboard (left pane). */
  shipmentCards(): Locator {
    return this.leftColumn.locator('[class*="Card"]')
  }
  /** The "+" / add-to-trip control on a shipment card. */
  addToTripButton(card: Locator): Locator {
    return card.getByRole('button')
  }

  /** Shipment cards currently in the pending trip (right pane). */
  pendingTripShipments(): Locator {
    return this.rightColumn.locator('[class*="Card"]')
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
    return this.page.locator('[class*="Snackbar"]')
  }

  async addFirstShipmentToTrip(): Promise<void> {
    const card = this.shipmentCards().first()
    await card.waitFor({ state: 'visible' })
    await this.addToTripButton(card).click()
  }

  async openWithTripId(tripId: string | number): Promise<void> {
    await this.page.goto(`${this.webUrl}/driver-planning/planning?tripId=${tripId}`, {
      waitUntil: 'domcontentloaded',
    })
  }
}
