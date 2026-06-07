// workflow_developer: developer persona that may upload Python workflow
// artifacts to the tenant's workflow store via the SDK / CLI. Read access is
// already covered by the tenant_user baseline (ReadWorkflow); this group
// adds the UploadWorkflow + RunWorkflow capabilities on top so a developer
// can ship and exercise a workflow without needing a separate tenant_admin
// grant.
permit (
  principal in Pegasus::Group::"workflow_developer",
  action in [
    Pegasus::Action::"ReadWorkflow",
    Pegasus::Action::"UploadWorkflow",
    Pegasus::Action::"RunWorkflow"
  ],
  resource
);
