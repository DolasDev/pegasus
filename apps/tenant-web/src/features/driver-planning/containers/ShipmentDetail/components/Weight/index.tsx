import React, { useEffect, useState } from 'react'
import { useFloating, offset } from '@floating-ui/react'
import { useSelector } from 'react-redux'

import { Button, IconButton } from '../../../../components/Button'
import { PopoverShell } from '../../../../components/PopoverShell'
import styles from './Weight.module.css'
import { patchShipmentShadow } from '../../../../redux/shipments'
import { HoverToolTip } from '@/features/driver-planning/containers/ToolTips'
import { InputField } from '@/features/driver-planning/components/InputField'
import { useAppDispatch } from '../../../../redux/hooks'
import type { RootState } from '../../../../redux/store'

// The shadow PATCH schema is `weight: number | null`. The input hands back a
// string, so an edited weight used to be posted as "16200" and rejected with a
// 400 — while an *unedited* one passed, because the initial state was already a
// number. Coerce here, and map a cleared/unparsable field to null rather than
// to Number('') === 0, which would overwrite a good weight with zero.
export const toWeight = (value: unknown): number | null => {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export const ShipmentWeight = ({ onUpdate }: { onUpdate: any }) => {
  const dispatch = useAppDispatch()
  const selectedShipment = useSelector(
    (state: RootState) => state.shipments.selectedShipment,
  ) as any
  const user = useSelector((state: RootState) => (state as any).user.user)
  const [editMode, setEditMode] = useState(false)

  const { refs, floatingStyles } = useFloating({
    middleware: [offset(5)],
  })

  // Keep the raw input value in state — an <input type="number"> hands back a
  // string on every change, and forcing it through Number() here produced NaN
  // whenever the shipment had no shadow weight yet (a controlled input with
  // value={NaN}). Coercion happens once, at save.
  const [weight, setWeight] = useState<any>(selectedShipment.pegasus_shadow?.weight ?? '')

  // Selecting another shipment does not remount this component (the detail pane
  // keeps the same tree position, and the deselect+select land in one React
  // batch), so without this the popover carried the previous shipment's weight
  // and saving would have written it onto the newly selected order.
  const orderNum = selectedShipment?.order_num
  useEffect(() => {
    setWeight(selectedShipment?.pegasus_shadow?.weight ?? '')
    setEditMode(false)
    // Deliberately keyed on the order number alone — re-running on every
    // `selectedShipment` change would clobber what the user is typing the
    // moment a shadow write lands.
  }, [orderNum])

  const onButtonClick = () => {
    setEditMode(!editMode)
  }

  const save = (shipmentShadowDto: any) => {
    dispatch(patchShipmentShadow(shipmentShadowDto) as any)
    setEditMode(!editMode)
    onUpdate(shipmentShadowDto.weight)
  }

  return (
    <span>
      <span ref={refs.setReference}>
        <HoverToolTip direction={'right'} content={'Update Weight'}>
          <IconButton
            style={{ color: `${weight ? 'green' : 'orange'}` }}
            onClick={() => onButtonClick()}
            Icon={<i className="fas fa-scale-unbalanced-flip"></i>}
          />
        </HoverToolTip>
      </span>
      <>
        {editMode && (
          <div className={styles['shipment-coverage-popover']}>
            <PopoverShell ref={refs.setFloating} style={floatingStyles}>
              <div>
                <div>
                  {/* The label pointed at "estimated_date" — an id no input on
                      this popover has (copy-paste from the coverage popover). */}
                  <label htmlFor="shipment-weight">Enter New Weight:</label>
                  <InputField
                    id="shipment-weight"
                    type={'number'}
                    value={weight}
                    onChange={(e: any) => {
                      setWeight(e.target.value)
                    }}
                  />
                </div>
                <div className={styles['shipment-coverage-buttons-container']}>
                  <Button
                    color="green"
                    onClick={() => {
                      const weightDto = {
                        order_num: selectedShipment.order_num,
                        weight: toWeight(weight),
                      }
                      save(weightDto)
                    }}
                  >
                    save
                  </Button>
                  <IconButton
                    className={styles.closeIcon}
                    onClick={() => setEditMode(false)}
                    Icon={<i className="fas fa-xmark"></i>}
                  />
                </div>
              </div>
            </PopoverShell>
          </div>
        )}
      </>
    </span>
  )
}
