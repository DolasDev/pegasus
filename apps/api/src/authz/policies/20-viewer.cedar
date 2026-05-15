// viewer: read-only baseline across the core operational entities. Any write
// action requires a more specific persona group (local_dispatch, sales, ...) or
// tenant_admin. Replaces the legacy `tenant_user` baseline; viewer is only ever
// granted by explicit admin assignment -- empty `roleNames` evaluates to deny.
permit (
  principal in Pegasus::Group::"viewer",
  action in [
    Pegasus::Action::"ReadQuote",
    Pegasus::Action::"ReadMove",
    Pegasus::Action::"ReadInvoice",
    Pegasus::Action::"ReadCustomer",
    Pegasus::Action::"ReadWorkflow"
  ],
  resource
);
