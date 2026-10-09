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
// SendEmail sends mail through the tenant's pegII API (internal recipients only).
// ReadTextMessage reads an inbound text by the id sms.received carries, and
// UpdateTextMessage marks it read at RingCentral (the source of read state);
// Read/ManageSmsOptOut read and record a number's opt-out (STOP) state.
// Read/WriteWorkflowState let a running workflow keep its own durable state
// (send ledgers, atomic claims, compare-and-set reclaims) in a tenant-wide store.
// ReadOrder/ReadTask let a lifecycle workflow re-fetch authoritative order and
// task state from an order.* event pointer; CloseTask lets it close out an
// order's operational task (e.g. date_confirmation) when the triggering event
// arrives. WriteOrder writes allowlisted fields (the integration statuses) back
// onto the pegII order - the one order mutation a workflow may make; the site
// enforces which fields. ReadSalesman re-fetches an authoritative salesman (sales user /
// employee) referenced from an order. Orders/salesmen/tasks are the pegII-bound
// operational surface (handlers/pegii-runtime.ts). DeliverToExternal lets a workflow hand the
// platform a mapped external body to POST to the partner endpoint server-side
// (the mutating counterpart to the open map-to-external transform), so the send
// flows through the platform and is dry-run-interceptable rather than a raw
// httpx call from the activity. CallExternal is its read/arbitrary-method
// sibling: a workflow names a method + path and the platform performs the call
// server-side, minting/caching an OAuth2 client-credentials token so the
// workflow never handles client_id/client_secret. CreateFeedbackRequest lets a
// workflow mint a capability link to a published feedback form (the mint-only
// primitive; the workflow sends it via SendSms), same persona shape as SendSms.
// ReadUsage lets a workflow read the tenant's usage summary (billable actions
// against the plan's pool) so it can check its own consumption.
permit (
  principal in Pegasus::Group::"workflow_runtime",
  action in [
    Pegasus::Action::"ReadQuote",
    Pegasus::Action::"ReadMove",
    Pegasus::Action::"ReadInvoice",
    Pegasus::Action::"ReadCustomer",
    Pegasus::Action::"ReadEvent",
    Pegasus::Action::"ReadOrder",
    Pegasus::Action::"WriteOrder",
    Pegasus::Action::"ReadSalesman",
    Pegasus::Action::"ReadTask",
    Pegasus::Action::"CloseTask",
    Pegasus::Action::"CreateEvent",
    Pegasus::Action::"EmitTenantEvent",
    Pegasus::Action::"SendSms",
    Pegasus::Action::"SendEmail",
    Pegasus::Action::"ReadTextMessage",
    Pegasus::Action::"UpdateTextMessage",
    Pegasus::Action::"ReadSmsOptOut",
    Pegasus::Action::"ManageSmsOptOut",
    Pegasus::Action::"DeliverToExternal",
    Pegasus::Action::"CallExternal",
    Pegasus::Action::"ReadWorkflowSecret",
    Pegasus::Action::"ReadWorkflowConfig",
    Pegasus::Action::"ReadIntegrationProjection",
    Pegasus::Action::"WriteIntegrationProjection",
    Pegasus::Action::"ReadWorkflowState",
    Pegasus::Action::"WriteWorkflowState",
    Pegasus::Action::"ReadBlob",
    Pegasus::Action::"WriteBlob",
    Pegasus::Action::"CreateFeedbackRequest",
    Pegasus::Action::"ReadUsage"
  ],
  resource
);
