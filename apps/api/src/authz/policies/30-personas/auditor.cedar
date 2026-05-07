// auditor: read-only across every operational entity. Strictly observational —
// no writes anywhere.
permit (
  principal,
  action in [
    Pegasus::Action::"ReadQuote",
    Pegasus::Action::"ReadMove",
    Pegasus::Action::"ReadInvoice",
    Pegasus::Action::"ReadCustomer"
  ],
  resource
) when {
  principal has "cognito:groups" &&
  principal["cognito:groups"].contains("auditor")
};
