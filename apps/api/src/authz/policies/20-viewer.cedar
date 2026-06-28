// viewer: read-only baseline across the core operational entities. Any write
// action requires a more specific persona group (local_dispatch, sales, ...) or
// tenant_admin. Replaces the legacy `tenant_user` baseline; viewer is only ever
// granted by explicit admin assignment -- empty `roleNames` evaluates to deny.
//
// ReadIntegrationConfig is here (not blanket) so the read-only Integrations
// mapping/ruleset viewer is open to business users without admin, while the
// empty-roles and stub-persona "deny everything" invariants stay intact.
// Publishing remains restricted to integration_publisher / tenant_admin.
permit (
  principal in Pegasus::Group::"viewer",
  action in [
    Pegasus::Action::"ReadQuote",
    Pegasus::Action::"ListMoves",
    Pegasus::Action::"ReadMove",
    Pegasus::Action::"ReadInvoice",
    Pegasus::Action::"ReadCustomer",
    Pegasus::Action::"ReadWorkflow",
    Pegasus::Action::"ReadIntegrationConfig"
  ],
  resource
);
