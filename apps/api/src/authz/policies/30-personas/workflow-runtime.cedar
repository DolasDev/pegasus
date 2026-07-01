// workflow_runtime: machine persona for the per-workflow runtime service
// account. Each workflow, at finalize and at fork, is issued its own scoped
// vnd_ API key bound to a service-account TenantUser in this group. The future
// Temporal worker authenticates with that key to call the Pegasus API on the
// workflow's behalf.
//
// The grant is deliberately narrow: read access to the operational entities a
// workflow inspects, plus CreateEvent so a workflow can record its own outcomes
// and EmitTenantEvent so a workflow can fire a tenant-defined custom event
// (workflow-to-workflow chaining). It does NOT include write access to quotes,
// moves, invoices, or customers - a runtime workflow observes and emits events,
// it does not mutate core records directly. ReadWorkflowSecret/ReadWorkflowConfig
// let a running workflow fetch the per-tenant secret/config values it declared in
// its manifest required_actions; it can read but never manage them.
// Read/WriteIntegrationProjection let a running workflow maintain the per-record
// external-state cache that the integration validator reads back as `prior`.
// ReadOrder/ReadTask let a lifecycle workflow re-fetch authoritative order and
// task state from an order.* event pointer; CloseTask lets it close out an
// order's operational task (e.g. date_confirmation) when the triggering event
// arrives. Orders/tasks are the pegII-bound operational surface
// (handlers/pegii-runtime.ts).
permit (
  principal in Pegasus::Group::"workflow_runtime",
  action in [
    Pegasus::Action::"ReadQuote",
    Pegasus::Action::"ReadMove",
    Pegasus::Action::"ReadInvoice",
    Pegasus::Action::"ReadCustomer",
    Pegasus::Action::"ReadEvent",
    Pegasus::Action::"ReadOrder",
    Pegasus::Action::"ReadTask",
    Pegasus::Action::"CloseTask",
    Pegasus::Action::"CreateEvent",
    Pegasus::Action::"EmitTenantEvent",
    Pegasus::Action::"SendSms",
    Pegasus::Action::"ReadWorkflowSecret",
    Pegasus::Action::"ReadWorkflowConfig",
    Pegasus::Action::"ReadIntegrationProjection",
    Pegasus::Action::"WriteIntegrationProjection"
  ],
  resource
);
