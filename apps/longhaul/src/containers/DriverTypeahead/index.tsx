import React from "react";
import startCase from "lodash/startCase";
import toLower from "lodash/toLower";
import Autocomplete from "../../components/Autocomplete";
import { useSelector } from "react-redux";
import type { RootState } from "../../redux/store";

export const DriverTypeahead = (args: any) => {
  const common = useSelector((state: RootState) => state.common);
  return (
    <Autocomplete
      options={(common.driversList.concat({driver_id:0, driver_name:'None'}) || []).map(
        (driver: any, idx: number) => ({
          label: startCase(toLower(driver.driver_name || "")),
          value: driver,
          key: idx
        })
      )}
      {...args}
    />
  );
};
