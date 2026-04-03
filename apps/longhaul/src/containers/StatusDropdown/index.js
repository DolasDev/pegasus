import React from 'react';
import {Select} from '../../components/Select';
import { useSelector } from 'react-redux';

export const StatusDropdown = (props) => {
    const common = useSelector((state) => state.common);

    return (
        <Select
            options={common.tripStatuses.map((status) => ({
                value: status.status_id,
                label: status.status,
            }))}
            {...props}
        />
    )
}