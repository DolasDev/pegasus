import React from 'react';
import {Select} from '../../components/Select';
import { useSelector } from 'react-redux';

export const StateDropdown = (props) => {
    const common = useSelector((state) => state.common);

    return (
        <Select
            options={common.stateList.map((state) => ({
                value: state,
                label: `${state.geo_name} (${state.geo_code})`,
            }))}
            {...props}
        />
    )
}