// integration_publisher: developer/platform persona that may publish and read
// integration-validator config (mapping + rules + corpus) via the SDK / CLI.
// Mirrors workflow_developer: a narrow, least-privilege grant on top of the
// tenant_user baseline so a config author does not need a full tenant_admin
// grant. tenant_admin covers both actions implicitly via its permit-everything
// policy. ASCII-only by the load.test.ts invariant.
permit (
  principal in Pegasus::Group::"integration_publisher",
  action in [
    Pegasus::Action::"ReadIntegrationConfig",
    Pegasus::Action::"PublishIntegrationConfig"
  ],
  resource
);
