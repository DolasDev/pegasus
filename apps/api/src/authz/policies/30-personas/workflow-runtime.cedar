// workflow_runtime: machine persona for the per-workflow runtime service
// account. Each workflow, at finalize and at fork, is issued its own scoped
// vnd_ API key bound to a service-account TenantUser in this group. The future
// Temporal worker authenticates with that key to call the Pegasus API on the
// workflow's behalf.
//
// The grant is deliberately narrow: read access to the operational entities a
// workflow inspects, plus CreateEvent so a workflow can record its own
// outcomes. It does NOT include write access to quotes, moves, invoices, or
// customers - a runtime workflow observes and emits events, it does not mutate
// core records directly.
permit (
  principal in Pegasus::Group::"workflow_runtime",
  action in [
    Pegasus::Action::"ReadQuote",
    Pegasus::Action::"ReadMove",
    Pegasus::Action::"ReadInvoice",
    Pegasus::Action::"ReadCustomer",
    Pegasus::Action::"ReadEvent",
    Pegasus::Action::"CreateEvent"
  ],
  resource
);
