import React from 'react';
import {Select} from '../../components/Select';
import { useSelector } from 'react-redux';
import type { RootState } from '../../redux/store';

export const StateDropdown = (props: any) => {
    const common = useSelector((state: RootState) => state.common);

    return (
        <Select
            options={common.stateList.map((state: any) => ({
                value: state,
                label: `${state.geo_name} (${state.geo_code})`,
            }))}
            {...props}
        />
    )
}
