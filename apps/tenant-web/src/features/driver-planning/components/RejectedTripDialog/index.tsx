import React, { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../Button'
import { InputField } from '../InputField'
import { DriverTypeahead } from '../../containers/DriverTypeahead'

// One driver's rejection of the trip: who turned it down and why.
export interface RejectionDraft {
  driverId: number
  driverName: string
  reason: string
}

interface RejectedTripDialogProps {
  open: boolean
  tripTitle?: string
  /** Drivers to pre-seed — typically the driver just removed/replaced. */
  initialDrivers?: Array<{ driverId: number; driverName?: string }>
  /** Record the rejection snapshot, then continue the save. */
  onRecord: (rejections: RejectionDraft[]) => void
  /** Save the trip without recording a rejection. */
  onSkip: () => void
  /** Abort — leave the trip unsaved. */
  onCancel: () => void
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  zIndex: 1,
}

const contentStyle: React.CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '460px',
  maxHeight: '80vh',
  overflowY: 'auto',
  zIndex: 50,
  fontSize: '12px',
  backgroundColor: 'white',
  borderRadius: '4px',
  padding: '20px',
}

export const RejectedTripDialog: React.FC<RejectedTripDialogProps> = ({
  open,
  tripTitle,
  initialDrivers,
  onRecord,
  onSkip,
  onCancel,
}) => {
  const [drivers, setDrivers] = useState<RejectionDraft[]>([])

  // Reset the list to the pre-seeded driver(s) each time the dialog opens.
  useEffect(() => {
    if (open) {
      setDrivers(
        (initialDrivers ?? [])
          .filter((d) => d.driverId != null && d.driverId !== 0)
          .map((d) => ({ driverId: d.driverId, driverName: d.driverName ?? '', reason: '' })),
      )
    }
  }, [open, initialDrivers])

  // Auto-add when a driver is picked (covers both Enter and click in the
  // Downshift typeahead). Skips the "None" sentinel and de-dupes by id.
  const addDriver = (option: any) => {
    const driver = option?.value
    if (!driver || driver.driver_id == null || driver.driver_id === 0) return
    setDrivers((prev) =>
      prev.some((d) => d.driverId === driver.driver_id)
        ? prev
        : [
            ...prev,
            { driverId: driver.driver_id, driverName: driver.driver_name ?? '', reason: '' },
          ],
    )
  }

  const setReason = (driverId: number, reason: string) =>
    setDrivers((prev) => prev.map((d) => (d.driverId === driverId ? { ...d, reason } : d)))

  const removeDriver = (driverId: number) =>
    setDrivers((prev) => prev.filter((d) => d.driverId !== driverId))

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay style={overlayStyle} />
        <Dialog.Content
          aria-describedby={undefined}
          data-target="rejected-trip-dialog"
          style={contentStyle}
        >
          <Dialog.Title asChild>
            <h2 style={{ marginTop: 0 }}>Record a rejected trip?</h2>
          </Dialog.Title>
          <p>
            The driver was removed from <b>{tripTitle ? tripTitle : 'this trip'}</b>. Add the
            driver(s) who rejected it and an optional reason. A read-only copy will appear in each
            driver&apos;s trip list.
          </p>

          <label style={{ fontWeight: 'bold' }}>Add a rejecting driver</label>
          <div data-target="rejected-trip-driver-typeahead">
            <DriverTypeahead onChange={addDriver} value={{ value: null, label: '' }} />
          </div>

          <div style={{ marginTop: '12px' }} data-target="rejected-trip-driver-list">
            {drivers.length === 0 ? (
              <div style={{ color: '#888', fontStyle: 'italic' }}>No drivers added yet.</div>
            ) : (
              drivers.map((d) => (
                <div
                  key={d.driverId}
                  data-target="rejected-trip-driver-row"
                  data-driver-id={String(d.driverId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '8px',
                  }}
                >
                  <span style={{ width: '120px', fontWeight: 'bold' }}>
                    {d.driverName || `Driver ${d.driverId}`}
                  </span>
                  <div style={{ flex: 1 }}>
                    <InputField
                      limit={2000}
                      placeholder="Reason (optional)"
                      value={d.reason}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setReason(d.driverId, e.target.value)
                      }
                    />
                  </div>
                  <button
                    type="button"
                    data-target="rejected-trip-remove-driver"
                    aria-label="Remove driver"
                    onClick={() => removeDriver(d.driverId)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    <i className="fas fa-trash" />
                  </button>
                </div>
              ))
            )}
          </div>

          <div
            style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}
          >
            <Button type="button" inverted color="rgb(172, 67, 67)" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" inverted onClick={onSkip} data-target="rejected-trip-skip">
              Save without recording
            </Button>
            <Button
              type="button"
              disabled={drivers.length === 0}
              data-target="rejected-trip-record"
              onClick={() => onRecord(drivers)}
            >
              Record rejection
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default RejectedTripDialog
