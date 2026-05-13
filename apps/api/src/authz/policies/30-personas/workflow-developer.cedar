// workflow_developer: developer persona that may upload Python workflow
// artifacts to the tenant's workflow store via the SDK / CLI. Read access is
// already covered by the tenant_user baseline (ReadWorkflow); this group
// adds the UploadWorkflow capability on top.
permit (
  principal in Pegasus::Group::"workflow_developer",
  action in [
    Pegasus::Action::"ReadWorkflow",
    Pegasus::Action::"UploadWorkflow"
  ],
  resource
);
