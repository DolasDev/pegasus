import React from "react";

import { Table } from "../../components/Table";
import { formatDate } from "../../utils/format-date";

function dateFormatter(date) {
  return date ? formatDate(date) : "";
}

function dateRange(date1, date2) {
  return `${dateFormatter(date1)} - ${dateFormatter(date2)}`;
}

const tableConfig = [
  { label: "Shipper", property: "shipper_name" },
  { label: "Origin City", property: "shipper_city" },
  { label: "O St", property: "shipper_state" },
  { label: "D City", property: "consignee_city" },
  { label: "D St", property: "consignee_state" },
  { label: "Est Wt", property: "total_est_wt" },
  {
    label: "Pack Range",
    property: "pack_date",
    property2: "pack_date2",
    accessor: ({ pack_date, pack_date2 }) => dateRange(pack_date, pack_date2)
  },
  {
    label: "Load Range",
    accessor: ({ load_date, load_date2 }) => dateRange(load_date, load_date2)
  },
  {
    label: "Del Range",
    accessor: ({ del_date, del_date2 }) => dateRange(del_date, del_date2)
  }
];

export const ShipmentsTable = ({ shipments }) => {
  return <Table rows={shipments} tableConfig={tableConfig} />;
};
