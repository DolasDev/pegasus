// auditor: read-only across every operational entity. Strictly observational —
// no writes anywhere.
permit (
  principal in Pegasus::Group::"auditor",
  action in [
    Pegasus::Action::"ReadQuote",
    Pegasus::Action::"ReadMove",
    Pegasus::Action::"ReadInvoice",
    Pegasus::Action::"ReadCustomer"
  ],
  resource
);
