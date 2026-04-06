import React, { useState } from 'react'
import { useFloating, offset } from '@floating-ui/react'
import { useSelector } from 'react-redux'

import { Button, IconButton } from '../../../../components/Button'
import { Popover } from '../../../../components/Popover'
import styles from './Weight.module.css'
import { patchShipmentShadow } from '../../../../redux/shipments'
import { HoverToolTip } from 'src/containers/ToolTips'
import { InputField } from 'src/components/InputField'
import { useAppDispatch } from '../../../../redux/hooks'
import type { RootState } from '../../../../redux/store'

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

  const [weight, setWeight] = useState<any>(Number(selectedShipment.pegasus_shadow?.weight))

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
            Icon={<i className="fas fa-balance-scale-right"></i>}
          />
        </HoverToolTip>
      </span>
      <>
        {editMode && (
          <div className={styles['shipment-coverage-popover']}>
            <Popover ref={refs.setFloating} style={floatingStyles}>
              <div>
                <div>
                  <label htmlFor="estimated_date">Enter New Weight:</label>
                  <InputField
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
                        weight: weight,
                      }
                      save(weightDto)
                    }}
                  >
                    save
                  </Button>
                  <IconButton
                    className={styles.closeIcon}
                    onClick={() => setEditMode(false)}
                    Icon={<i className="fa fa-close"></i>}
                  />
                </div>
              </div>
            </Popover>
          </div>
        )}
      </>
    </span>
  )
}
