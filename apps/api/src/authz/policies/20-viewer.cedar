// viewer: read-only baseline across the core operational entities. Any write
// action requires a more specific persona group (local_dispatch, sales, ...) or
// tenant_admin. Replaces the legacy `tenant_user` baseline; viewer is only ever
// granted by explicit admin assignment -- empty `roleNames` evaluates to deny.
//
// ReadIntegrationConfig is here (not blanket) so the read-only Integrations
// mapping/ruleset viewer is open to business users without admin, while the
// empty-roles and stub-persona "deny everything" invariants stay intact.
// Publishing remains restricted to integration_publisher / tenant_admin.
//
// RateShipment/ReadTariff are here for the same reason -- rating a shipment
// and browsing published tariff versions is a normal business-user action,
// not an admin one. There is no tenant-facing import/activate action at all:
// mutating the platform-global tariff data lives on the PLATFORM_ADMIN surface
// (POST /api/admin/tariffs), outside every tenant's Cedar store.
//
// ReadReportingDataset is here for the same reason, and this is the grant that
// actually makes the reporting surface reachable for business users. It only
// opens the catalog + query ROUTES; each dataset independently requires the
// action it reads (ListMoves, ReadInvoice, ...), so a viewer sees exactly the
// datasets their other grants already permit and nothing more.
permit (
  principal in Pegasus::Group::"viewer",
  action in [
    Pegasus::Action::"ReadQuote",
    Pegasus::Action::"ListMoves",
    Pegasus::Action::"ReadMove",
    Pegasus::Action::"ReadInvoice",
    Pegasus::Action::"ReadCustomer",
    Pegasus::Action::"ReadWorkflow",
    Pegasus::Action::"ReadIntegrationConfig",
    Pegasus::Action::"ReadIntegrationProjection",
    Pegasus::Action::"ReadFeedbackForms",
    Pegasus::Action::"RateShipment",
    Pegasus::Action::"ReadTariff",
    Pegasus::Action::"ReadReportingDataset"
  ],
  resource
);
