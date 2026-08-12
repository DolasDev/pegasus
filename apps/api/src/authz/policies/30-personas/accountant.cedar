// accountant: full control over invoices, read access to the moves and quotes
// the invoices are derived from. May delete/archive documents (read + upload
// come from the shared grant in 50-documents-shared.cedar).
permit (
  principal in Pegasus::Group::"accountant",
  action in [
    Pegasus::Action::"ReadInvoice",
    Pegasus::Action::"CreateInvoice",
    Pegasus::Action::"UpdateInvoice",
    Pegasus::Action::"DeleteInvoice",
    Pegasus::Action::"ReadQuote",
    Pegasus::Action::"ListMoves",
    Pegasus::Action::"ReadMove",
    Pegasus::Action::"ReadCustomer",
    Pegasus::Action::"DeleteDocument",
    Pegasus::Action::"ReadReportingDataset"
  ],
  resource
);
