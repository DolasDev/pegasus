import React from "react";
import { ShipmentsTable } from "../containers/ShipmentsTable";
import { useSelector } from "react-redux";
import { FilterTabs } from "../containers/Shipments/components/FilterTabs";
import { Lane } from "../components/Lane";
import type { RootState } from "../redux/store";

export function ShipmentModule() {
  const shipments = useSelector((state: RootState) => state.shipments.shipmentList);
  const query = useSelector((state: RootState) => state.shipments.query);
  return (
    <>
      <h1>Shipments Module</h1>
      <Lane key="Shipments" title="Shipments">
        <FilterTabs />
        <ShipmentsTable shipments={shipments} />
      </Lane>
    </>
  );
}
