// workflow_developer: developer persona that may upload Python workflow
// artifacts to the tenant's workflow store via the SDK / CLI. Read access is
// already covered by the tenant_user baseline (ReadWorkflow); this group
// adds the UploadWorkflow + RunWorkflow + ManageWorkflowTriggers
// capabilities on top so a developer can ship, exercise, and wire up a
// workflow without needing a separate tenant_admin grant.
// CancelWorkflowExecution + RetryWorkflowExecution let a developer drive
// executions from the tenant UI (cancel a stuck run, retry a failed one).
// ManageEventTypes
// lets a developer register the custom event types their workflows trigger on.
// ManageWorkflowSecrets/ManageWorkflowConfigs let a developer publish the
// per-tenant secret/config values their workflows read at runtime (via the SDK
// CLI). tenant_admin covers all of these implicitly via its permit-everything
// policy.
permit (
  principal in Pegasus::Group::"workflow_developer",
  action in [
    Pegasus::Action::"ReadWorkflow",
    Pegasus::Action::"UploadWorkflow",
    Pegasus::Action::"RunWorkflow",
    Pegasus::Action::"ManageWorkflowTriggers",
    Pegasus::Action::"CancelWorkflowExecution",
    Pegasus::Action::"RetryWorkflowExecution",
    Pegasus::Action::"ManageEventTypes",
    Pegasus::Action::"ManageWorkflowSecrets",
    Pegasus::Action::"ManageWorkflowConfigs",
    Pegasus::Action::"ManageIngress",
    Pegasus::Action::"ManageFeedbackForms",
    Pegasus::Action::"ReadReportingDataset"
  ],
  resource
);
