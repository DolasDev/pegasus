import React, { useState } from 'react'
import { useFloating, offset } from '@floating-ui/react'
import { useDispatch, useSelector } from 'react-redux'

import { Button, IconButton } from '../../../../components/Button'
import { Popover } from '../../../../components/Popover'
import styles from './Coverage.module.css'
import { saveShipmentCoverage } from '../../../../redux/shipments'
import { HoverToolTip } from 'src/containers/ToolTips'
import type { RootState } from '../../../../redux/store'
import { useAppDispatch } from '../../../../redux/hooks'

export const ShipmentCoverage = ({ onUpdate }: { onUpdate: any }) => {
  const dispatch = useAppDispatch()
  const selectedShipment = useSelector(
    (state: RootState) => state.shipments.selectedShipment,
  ) as any
  const user = useSelector((state: RootState) => (state as any).user.user)
  const [editMode, setEditMode] = useState(false)

  const [coverageElement, setCoverageElement] = useState<HTMLSpanElement | null>(null)
  const { refs, floatingStyles } = useFloating({
    middleware: [offset(5)],
  })

  const [coverageNote, setCoverageNote] = useState(selectedShipment.packing_coverage?.note)
  const [isCovered, setIsCovered] = useState(
    selectedShipment.packing_coverage === null
      ? null
      : selectedShipment.packing_coverage?.is_covered,
  )

  const onButtonClick = () => {
    setEditMode(!editMode)
  }

  const save = (shipmentCoverageDto: any) => {
    dispatch(saveShipmentCoverage(shipmentCoverageDto) as any)
    setEditMode(!editMode)
    onUpdate()
  }

  return (
    <span>
      <span ref={refs.setReference}>
        <HoverToolTip direction={'right'} content={'Update Agent Commitment'}>
          <IconButton
            style={{ color: `${isCovered === null ? 'orange' : isCovered ? 'green' : 'brown'}` }}
            onClick={() => onButtonClick()}
            Icon={<i className="fas fa-user-shield"></i>}
          />
        </HoverToolTip>
      </span>
      <>
        {editMode && (
          <div className={styles['shipment-coverage-popover']}>
            <Popover ref={refs.setFloating} style={floatingStyles}>
              <div>
                <YesNoToggle
                  label={'OA Committed?'}
                  startingPosition={isCovered}
                  onToggle={(value: any) => {
                    setIsCovered(value)
                  }}
                />
                <div>
                  <label htmlFor="estimated_date">Coverage Notes:</label>
                  <div>
                    <span
                      ref={setCoverageElement}
                      contentEditable="true"
                      style={{
                        display: 'inline-block',
                        border: 'solid 1px black',
                        minWidth: '300px',
                        minHeight: '100px',
                        maxWidth: '300px',
                        whiteSpace: 'pre-line',
                      }}
                      onChange={() => {
                        //this doesnt work aparently...
                      }}
                    >
                      {coverageNote}
                    </span>
                  </div>
                </div>
                <div className={styles['shipment-coverage-buttons-container']}>
                  <Button
                    color="green"
                    onClick={() => {
                      const coverageData = {
                        id: selectedShipment.packing_coverage?.id,
                        order_num: selectedShipment.order_num,
                        created_by_id:
                          selectedShipment.packing_coverage?.created_by_id || user.code,
                        updated_by_id: selectedShipment.packing_coverage
                          ? user.updated_by_id
                          : null,
                        activity_code: 'PACK',
                        note: coverageElement?.innerHTML
                          .replace(/\s?(<br\s?\/?>)\s?/g, '\r\n')
                          .replace(/&nbsp;/g, ' '),
                        is_covered: isCovered === null ? null : isCovered,
                        coverage_agent_id: selectedShipment.oa_id,
                      }
                      setCoverageNote(coverageData.note)
                      save(coverageData)
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

const YesNoToggle = (props: {
  label: string
  startingPosition: any
  onToggle: (value: any) => void
}) => {
  const [status, setStatus] = useState(props.startingPosition)
  return (
    <div>
      <span>
        <label htmlFor="estimated_date">{props.label} </label>
        <span style={{ marginLeft: '5px' }}>
          <IconButton
            style={
              status !== null && !status
                ? { color: 'white', backgroundColor: 'brown', borderRadius: '3px 0px 0px 3px' }
                : { color: 'white', backgroundColor: 'grey', borderRadius: '3px 0px 0px 3px' }
            }
            onClick={() => {
              props.onToggle(false)
              setStatus(false)
            }}
            Icon={<span>No</span>}
          />
          <IconButton
            style={
              status === null
                ? { color: 'white', backgroundColor: 'orange' }
                : { color: 'white', backgroundColor: 'DarkGrey' }
            }
            onClick={() => {
              props.onToggle(null)
              setStatus(null)
            }}
            Icon={<span>?</span>}
          />
          <IconButton
            style={
              status
                ? { color: 'white', backgroundColor: 'green', borderRadius: '0px 3px 3px 0px' }
                : { color: 'white', backgroundColor: 'grey', borderRadius: '0px 3px 3px 0px' }
            }
            onClick={() => {
              props.onToggle(true)
              setStatus(true)
            }}
            Icon={<span>yes</span>}
          />
        </span>
      </span>
    </div>
  )
}
