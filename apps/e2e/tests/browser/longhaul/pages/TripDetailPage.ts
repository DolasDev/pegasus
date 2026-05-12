import type { Page, Locator } from '@playwright/test'

// ---------------------------------------------------------------------------
// TripDetailPage — /driver-planning/trips/:tripId
// Source: apps/tenant-web/src/features/driver-planning/containers/Trip/index.tsx
//   → <Lane title>, <ActivityGantt/> (activities grouped by shipment, planned
//     vs actual dates, mismatch highlighting), <Notes/> (add/edit/delete),
//     trip-status dropdown (TripStatusOptions) with a status-prediction prompt,
//     date-change prompt on activity edit, and <ShipmentDetail/> on click
//     (order# is a <Clickable/> → API.jumpToOrder).
//
// NOTE: locators derived from source; confirm in Phase A and add data-testids
// to ActivityGantt / Notes / the status dropdown where role/text is brittle.
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

  get gantt(): Locator {
    return this.page.locator('[class*="ActivityGantt"], [class*="Gantt"]')
  }
  get activityRows(): Locator {
    // TODO Phase A: confirm a per-activity selector / add data-testid.
    return this.gantt.locator('[class*="activity"], [class*="Activity"]')
  }
  get notes(): Locator {
    return this.page.locator('[class*="Notes"]')
  }
  addNoteButton(): Locator {
    return this.notes.getByRole('button', { name: /add note/i })
  }

  /** Trip-status control (dropdown). */
  get statusControl(): Locator {
    // react-select-based — TODO Phase A: confirm.
    return this.page.locator('[class*="StatusDropdown"], [class*="status"]').first()
  }

  /** Status-prediction prompt shown before committing a status change. */
  get statusPrompt(): Locator {
    return this.page.getByText(/status/i).filter({ hasText: /confirm|update|predict/i })
  }
  /** Date-change prompt shown when editing an activity's planned dates. */
  get dateChangePrompt(): Locator {
    return this.page.getByRole('dialog')
  }

  shipmentDetailPane(): Locator {
    return this.page.locator('[class*="ShipmentDetail"]')
  }
  orderNumberLink(): Locator {
    return this.shipmentDetailPane().getByRole('link').first()
  }
}
