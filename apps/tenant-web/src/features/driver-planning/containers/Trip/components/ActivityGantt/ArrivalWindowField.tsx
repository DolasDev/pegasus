// ---------------------------------------------------------------------------
// Arrival-window editor inside the Gantt activity popover.
//
// Operations collects an arrival spread from the driver ("we'll be there
// between 8 and 10") and customer service quotes it to the customer the day
// before. The times are LOCAL to the activity's address, so this control edits
// three fields together: two wall-clock times and the IANA zone they are read
// in.
//
// THREE DESIGN POINTS WORTH KEEPING:
//
// 1. Native <input type="time">, not the DatePicker used above it. It hands
//    back a plain `"HH:mm"` string — no Date object, no locale parsing, and
//    nothing for a timezone to shift. That is the same discipline the date
//    columns arrived at the hard way (see utils/date.ts `toLocalDateOnly`).
//
// 2. The zone is auto-applied ONLY where the server is confident, which means
//    the state or province lies wholly inside one zone. In the 14 states that
//    span two (Texas, Florida, Tennessee, Indiana…) the server's guess is shown
//    as a suggestion but NOT selected, and the window cannot be saved until a
//    person picks. Silently defaulting there is how a customer gets texted an
//    hour early.
//
// 3. Nothing is stored until the popover's save. An empty window means "not
//    communicated yet" — never an implied 8–10 — because the automation that
//    will send these messages has to be able to tell those apart.
// ---------------------------------------------------------------------------

import {
  ARRIVAL_WINDOW_TIME_ZONES,
  DEFAULT_ARRIVAL_WINDOW,
  arrivalWindowZoneLabel,
  type ArrivalWindowZoneConfidence,
} from '@pegasus/longhaul-contracts'

import styles from './ActivityGantt.module.css'
import { formatArrivalWindow } from '../../../../utils/arrival-window'

export interface ArrivalWindowFieldProps {
  start: string | null | undefined
  end: string | null | undefined
  timeZone: string | null | undefined
  /** What the server would pick for this address, and how sure it is. */
  suggestedTimeZone: string | null | undefined
  confidence: ArrivalWindowZoneConfidence | undefined
  /** Why the server is or isn't sure — shown verbatim to the dispatcher. */
  reason: string | undefined
  /** The day the window applies to (`estimated_date ?? planned_start`). */
  windowDate: string | null | undefined
  /** `EDT` / `PST` at that date, derived server-side. */
  zoneLabel: string | null | undefined
  onChange: (patch: Record<string, string | null>) => void
}

export function ArrivalWindowField({
  start,
  end,
  timeZone,
  suggestedTimeZone,
  confidence,
  reason,
  windowDate,
  zoneLabel,
  onChange,
}: ArrivalWindowFieldProps) {
  const hasWindow = Boolean(start || end)

  const add = () => {
    onChange({
      arrival_window_start: DEFAULT_ARRIVAL_WINDOW.start,
      arrival_window_end: DEFAULT_ARRIVAL_WINDOW.end,
      // Only pre-select the zone where the server is sure. Anywhere else the
      // dispatcher chooses, which is the whole point of the split-state case.
      arrival_window_tz: confidence === 'confident' ? (suggestedTimeZone ?? '') : '',
    })
  }

  const remove = () => {
    onChange({
      arrival_window_start: null,
      arrival_window_end: null,
      arrival_window_tz: null,
    })
  }

  /**
   * Emptying BOTH time inputs removes the window, zone included.
   *
   * Without this the zone survives in popover state while `hasWindow` goes
   * false, so the block collapses back to "+ Add arrival window" — and the next
   * save posts a zone with no times, which the API rejects with a message about
   * missing times while the screen is showing no window at all. Nothing the
   * dispatcher can see explains the error.
   */
  const setTime = (field: 'arrival_window_start' | 'arrival_window_end', raw: string) => {
    const next = raw || null
    const other = field === 'arrival_window_start' ? end : start
    if (next === null && !other) {
      remove()
      return
    }
    onChange({ [field]: next })
  }

  if (!hasWindow) {
    return (
      <div className={styles.formField} data-target="arrival-window">
        <button
          type="button"
          className="pegasus-link"
          onClick={add}
          data-target="add-arrival-window"
        >
          + Add arrival window
        </button>
      </div>
    )
  }

  const needsZone = !timeZone

  return (
    <div className={styles.formField} data-target="arrival-window">
      <label htmlFor="arrival_window_start">Arrival Window</label>
      <div className={styles.arrivalWindowRow}>
        <input
          type="time"
          id="arrival_window_start"
          name="arrival_window_start"
          aria-label="Arrival window start"
          value={start ?? ''}
          onChange={(e) => setTime('arrival_window_start', e.target.value)}
        />
        <span className={styles.arrivalWindowDash}>to</span>
        <input
          type="time"
          name="arrival_window_end"
          aria-label="Arrival window end"
          value={end ?? ''}
          onChange={(e) => setTime('arrival_window_end', e.target.value)}
        />
        <button
          type="button"
          className="pegasus-link"
          onClick={remove}
          data-target="remove-arrival-window"
        >
          remove
        </button>
      </div>

      <div className={styles.arrivalWindowRow}>
        <select
          name="arrival_window_tz"
          aria-label="Arrival window time zone"
          value={timeZone ?? ''}
          onChange={(e) => onChange({ arrival_window_tz: e.target.value || null })}
        >
          <option value="">Select a time zone…</option>
          {ARRIVAL_WINDOW_TIME_ZONES.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.label}
              {zone.id === suggestedTimeZone ? ' — suggested' : ''}
            </option>
          ))}
        </select>
      </div>

      {needsZone ? (
        // The blocking case: times entered, no zone. `reason` explains WHY the
        // server would not choose — "TX spans two time zones", say — so the
        // dispatcher knows this is a real question and not a stray dropdown.
        <div className={styles.arrivalWindowWarning} data-target="arrival-window-needs-zone">
          Pick the time zone at the activity address to save this window.
          {reason ? ` ${reason}.` : ''}
        </div>
      ) : (
        <div className={styles.arrivalWindowSummary} data-target="arrival-window-summary">
          {formatArrivalWindow({ start, end, windowDate, zoneLabel })}
          {confidence === 'likely' ? (
            <span className={styles.arrivalWindowWarning}> — {reason}</span>
          ) : null}
        </div>
      )}

      {!needsZone && timeZone !== suggestedTimeZone && suggestedTimeZone ? (
        <div className={styles.arrivalWindowSummary}>
          Address suggests {arrivalWindowZoneLabel(suggestedTimeZone)}.
        </div>
      ) : null}
    </div>
  )
}
