import React from "react";
import { ShipmentsTable } from "../containers/ShipmentsTable";
import { useSelector } from "react-redux";
import { FilterTabs } from "../containers/Shipments/components/FilterTabs";
import { Lane } from "../components/Lane";

export function ShipmentModule() {
  const shipments = useSelector(state => state.shipments.shipmentList);
  const query = useSelector(state => state.shipments.query);
  return (
    <>
      <h1>Shipments Module</h1>
      <Lane key="Shipments" title="Shipments">
        <FilterTabs query={query} />
        <ShipmentsTable shipments={shipments} />
      </Lane>
    </>
  );
}
