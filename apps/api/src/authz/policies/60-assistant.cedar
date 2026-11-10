// AI assistant (shared feature policy): operations_admin may use the assistant
// and author its prompt in the Assistant Lab. tenant_admin already holds both
// through its permit-everything policy.
//
// Deliberately NOT written into 30-personas/operations-admin.cedar, which stays
// a comment-only placeholder (Operations is gated by role name, not Cedar). This
// file is the one named exception, pinned by lib/authz.test.ts.
//
// UseAssistant is only a feature gate: each tool the model can call is filtered
// by, and re-authorized against, the caller's own action for that data.
// Top level (not under 30-personas/); one static policy per file (AVP).
permit (
  principal in Pegasus::Group::"operations_admin",
  action in [Pegasus::Action::"UseAssistant", Pegasus::Action::"ManageAssistantPrompt"],
  resource
);
