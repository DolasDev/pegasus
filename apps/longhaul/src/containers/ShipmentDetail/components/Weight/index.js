import React, { useState } from "react";
import { useFloating, offset } from '@floating-ui/react';
import { useDispatch, useSelector } from "react-redux";

import { Button, IconButton } from "../../../../components/Button";
import { Popover } from '../../../../components/Popover';
import  styles  from "./Weight.module.css";
import { patchShipmentShadow } from "../../../../redux/shipments"
import { HoverToolTip } from 'src/containers/ToolTips'
import { InputField } from 'src/components/InputField';



export const ShipmentWeight = ({onUpdate}) => {
  const dispatch = useDispatch()
    const selectedShipment = useSelector(
      (state) => state.shipments.selectedShipment
    );
    const user = useSelector(
      (state) => state.user.user
    );
    const [editMode, setEditMode] = useState(false);
    
    const { refs, floatingStyles } = useFloating({
      middleware: [offset(5)],
    });
  
    const [weight, setWeight] = useState(Number(selectedShipment.pegasus_shadow?.weight));
  
    const onButtonClick= () => {
      setEditMode(!editMode)
    };

    const save = (shipmentShadowDto) => {
      dispatch(patchShipmentShadow(shipmentShadowDto))
      setEditMode(!editMode)
      onUpdate(shipmentShadowDto.weight)
    };

  
    return(
    <span>
      <span ref={refs.setReference}>
        <HoverToolTip direction={'right'} content={'Update Weight'}>
          <IconButton
          style={{color: `${weight ? 'green' : 'orange'}`}}
          onClick={() => onButtonClick()}
          Icon={<i className="fas fa-balance-scale-right"></i>}
          />
        </HoverToolTip>
      </span>
      <>
       {editMode && (<div className={styles['shipment-coverage-popover']}>
        <Popover ref={refs.setFloating} style={floatingStyles} >
          <div>
            <div>
              <label htmlFor="estimated_date">Enter New Weight:</label>
              <InputField type={'number'} value={weight} onChange={(e) => {setWeight(e.target.value);}}/>
            </div>
            <div className={styles['shipment-coverage-buttons-container']}>
              <Button
                  color="green"
                  onClick={() => {
                    const weightDto = {
                      order_num: selectedShipment.order_num,
                      weight: weight
                    }
                    save(weightDto)
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