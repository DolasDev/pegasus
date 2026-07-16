import type { Page, Locator } from '@playwright/test'

// ---------------------------------------------------------------------------
// TripDetailPage — /driver-planning/trips/:tripId
// Source: apps/tenant-web/src/features/driver-planning/containers/Trip/index.tsx
//   + components/ActivityGantt/ActivityGantt.tsx + components/Notes/Notes.tsx.
//
// Selectors use the `data-target` hooks added to Trip / ActivityGantt / Notes /
// ShipmentDetail.
// ---------------------------------------------------------------------------

export class TripDetailPage {
  constructor(
    readonly page: Page,
    readonly webUrl: string,
  ) {}

  async goto(tripId: string | number): Promise<void> {
    await this.page.goto(`${this.webUrl}/driver-planning/trips/${tripId}`, {
      waitUntil: 'domcontentloaded',
    })
  }

  // -- header / navigation --------------------------------------------------
  /** Header "Driver <name>" — renders "Unassigned" when the trip has no driver. */
  get driverField(): Locator {
    return this.page.locator('[data-target="trip-driver"]')
  }
  get backToTripsButton(): Locator {
    return this.page.locator('[data-target="trip-back-to-trips"]')
  }
  get editPlanningButton(): Locator {
    return this.page.locator('[data-target="trip-edit-planning"]')
  }

  // -- activity gantt -------------------------------------------------------
  get gantt(): Locator {
    return this.page.locator('[data-target="activity-gantt"]')
  }
  get activityRows(): Locator {
    return this.page.locator('[data-target="gantt-activity-row"]')
  }
  activityRowById(activityId: string | number): Locator {
    return this.page.locator(`[data-target="gantt-activity-row"][data-activity-id="${activityId}"]`)
  }
  /** Activity rows for a given shipment order number. */
  activityRowsForOrder(orderNum: string | number): Locator {
    return this.page.locator(`[data-target="gantt-activity-row"][data-order-num="${orderNum}"]`)
  }

  // -- left-column shipment list (clickable → ShipmentDetail) ---------------
  get shipmentActivityCards(): Locator {
    return this.page.locator('[data-target="trip-shipment-activity"]')
  }

  // -- status ---------------------------------------------------------------
  get statusSteps(): Locator {
    return this.page.locator('[data-target="trip-status-step"]')
  }
  statusStep(status: string): Locator {
    return this.page.locator(`[data-target="trip-status-step"][data-status="${status}"]`)
  }
  /** The currently-active status step (`data-active="true"`). */
  get activeStatusStep(): Locator {
    return this.page.locator('[data-target="trip-status-step"][data-active="true"]')
  }
  /** Status-prediction / confirm prompt shown before committing a status change. */
  get statusPrompt(): Locator {
    return this.page.getByRole('dialog')
  }

  // -- notes ----------------------------------------------------------------
  get notes(): Locator {
    return this.page.locator('[data-target="trip-notes"]')
  }
  get addNoteButton(): Locator {
    return this.page.locator('[data-target="add-note"]')
  }
  get noteCards(): Locator {
    return this.page.locator('[data-target="trip-note"]')
  }
  noteCardById(noteId: string): Locator {
    return this.page.locator(`[data-target="trip-note"][data-note-id="${noteId}"]`)
  }
  editNoteButton(noteCard: Locator): Locator {
    return noteCard.locator('[data-target="edit-note"]')
  }
  get noteInput(): Locator {
    return this.page.locator('[data-target="note-input"]')
  }
  get saveNoteButton(): Locator {
    return this.page.locator('[data-target="save-note"]')
  }
  get cancelNoteButton(): Locator {
    return this.page.locator('[data-target="cancel-note"]')
  }

  // -- shipment detail pane -------------------------------------------------
  get shipmentDetailPane(): Locator {
    return this.page.locator('[data-target="shipment-detail"]')
  }
  shipmentDetailField(label: string): Locator {
    return this.page.locator(`[data-target="shipment-detail-field"][data-field="${label}"]`)
  }
  get orderNumberLink(): Locator {
    // "Order Number" row renders a <Clickable> button; "Trip Id" renders a <Link>.
    return this.shipmentDetailField('Trip Id').getByRole('link').first()
  }
}
