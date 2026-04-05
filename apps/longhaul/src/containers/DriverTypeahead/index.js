import React from "react";
import { startCase } from "../../utils/string";
import Autocomplete from "../../components/Autocomplete";
import { useSelector } from "react-redux";

export const DriverTypeahead = (args) => {
  const common = useSelector(state => state.common);
  return (
    <Autocomplete 
      options={(common.driversList.concat({driver_id:0, driver_name:'None'}) || []).map(
        (driver, idx) => ({
          label: startCase((driver.driver_name || "").toLowerCase()),
          value: driver,
          key: idx
        })
      )}
      {...args}
    />
  );
};
