import React, { useState } from "react";
import { usePopper } from 'react-popper';
import { useSelector } from "react-redux";

import { Button, IconButton } from "../../../../components/Button";
import { Popover } from '../../../../components/Popover';
import  styles  from "./DispatchNote.module.css";
import { patchShipmentShadow } from "../../../../redux/shipments"
import { HoverToolTip } from 'src/containers/ToolTips'
import { InputField } from 'src/components/InputField';
import { useAppDispatch } from '../../../../redux/hooks';
import type { RootState } from '../../../../redux/store';



export const DispatchNote = ({onUpdate}: { onUpdate: any }) => {
  const dispatch = useAppDispatch()
    const selectedShipment = useSelector(
      (state: RootState) => state.shipments.selectedShipment
    ) as any;
    const user = useSelector(
      (state: RootState) => (state as any).user.user
    );
    const [editMode, setEditMode] = useState(false);

    const [referenceElement, setReferenceElement] = useState<HTMLSpanElement | null>(null);
    const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
    const [arrowElement, setArrowElement] = useState<HTMLDivElement | null>(null);
    const { styles: popperStyles, attributes } = usePopper(referenceElement, popperElement, {
      modifiers: [
        { name: 'arrow', options: { element: arrowElement } },
        {
          name: 'offset',
          options: {
            offset: [0, 5],
          },
        },
      ],
    });

    const [dispatchNote, setDispatchNote] = useState(selectedShipment.pegasus_shadow.lng_dis_comments);



    const onButtonClick= () => {
      setEditMode(!editMode)
    };

    const save = (shipmentShadowDto: any) => {
      dispatch(patchShipmentShadow(shipmentShadowDto) as any)
      setEditMode(!editMode)
      onUpdate(shipmentShadowDto.lng_dis_comments)
    };


    return(
    <span>
      <span ref={setReferenceElement}>
        <HoverToolTip direction={'right'} content={'Update Comment'}>
          <IconButton
          style={{color: 'green'}}
          onClick={() => onButtonClick()}
          Icon={<i className={`fas fa-comment-dots`}></i>}
          />
        </HoverToolTip>
        {dispatchNote?.split('')?.map((char: any)=> char.toLowerCase() === '!' ? <i style={{color: `${'orange'}`}} className='fas fa-exclamation'/>: null)}
      </span>
      <>
       {editMode && (<div className={styles['shipment-coverage-popover']}>
        <Popover ref={setPopperElement} style={popperStyles.popper} {...attributes.popper} >
          <div>
            <div>
              <label htmlFor="estimated_date">Update Comment:</label>
              <InputField maxLength={160} value={dispatchNote} onChange={(e: any) => {setDispatchNote(e.target.value);}}/>
            </div>
            <div className={styles['shipment-coverage-buttons-container']}>
              <Button
                  color="green"
                  onClick={() => {
                    const shipmentShadowDto = {
                      order_num: selectedShipment.order_num,
                      lng_dis_comments: dispatchNote
                    }

                    save(shipmentShadowDto)
                  }}
                >
                  save
              </Button>
              <IconButton
                className={styles.closeIcon}
                onClick={() => setEditMode(false) }
                Icon={<i className="fa fa-close"></i>}
              />
            </div>
          </div>
        </Popover>
        </div>)}
      </>
    </span>
      )
  }
