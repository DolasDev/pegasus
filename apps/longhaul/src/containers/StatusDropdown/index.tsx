import React from 'react';
import {Select} from '../../components/Select';
import { useSelector } from 'react-redux';
import type { RootState } from '../../redux/store';

export const StatusDropdown = (props: any) => {
    const common = useSelector((state: RootState) => state.common);

    return (
        <Select
            options={common.tripStatuses.map((status: any) => ({
                value: status.status_id,
                label: status.status,
            }))}
            {...props}
        />
    )
}
