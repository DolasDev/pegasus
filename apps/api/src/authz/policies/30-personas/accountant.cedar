// accountant: full control over invoices, read access to the moves and quotes
// the invoices are derived from.
permit (
  principal,
  action in [
    Pegasus::Action::"ReadInvoice",
    Pegasus::Action::"CreateInvoice",
    Pegasus::Action::"UpdateInvoice",
    Pegasus::Action::"DeleteInvoice",
    Pegasus::Action::"ReadQuote",
    Pegasus::Action::"ReadMove",
    Pegasus::Action::"ReadCustomer"
  ],
  resource
) when {
  principal has "cognito:groups" &&
  principal["cognito:groups"].contains("accountant")
};
