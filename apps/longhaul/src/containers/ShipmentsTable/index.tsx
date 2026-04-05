import React from "react";

import { Table } from "../../components/Table";
import { formatDate } from "../../utils/format-date";

function dateFormatter(date: any): string {
  return date ? formatDate(date) || "" : "";
}

function dateRange(date1: any, date2: any): string {
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
    accessor: ({ pack_date, pack_date2 }: any) => dateRange(pack_date, pack_date2)
  },
  {
    label: "Load Range",
    accessor: ({ load_date, load_date2 }: any) => dateRange(load_date, load_date2)
  },
  {
    label: "Del Range",
    accessor: ({ del_date, del_date2 }: any) => dateRange(del_date, del_date2)
  }
];

interface ShipmentsTableProps {
  shipments: any[];
}

export const ShipmentsTable: React.FC<ShipmentsTableProps> = ({ shipments }) => {
  return <Table rows={shipments} tableConfig={tableConfig} />;
};
