// tenant_user: read-only baseline across the core operational entities. Any
// write action requires a more specific persona group (dispatcher, sales, …)
// or tenant_admin.
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
  principal["cognito:groups"].contains("tenant_user")
};
