// billing_manager (legacy BM): broader billing/accounting permissions are still
// TBD (payroll, driver debits, budgets, invoice key dates, currency rates).
// For now the only granted permission is deleting/archiving documents, alongside
// accountant and tenant_admin. Read + upload come from the shared grant in
// 50-documents-shared.cedar.
permit (
  principal in Pegasus::Group::"billing_manager",
  action in [Pegasus::Action::"DeleteDocument", Pegasus::Action::"ReadReportingDataset"],
  resource
);
