// tenant_admin: full access to every action and every resource in this tenant
// store. The per-tenant policy store boundary makes cross-tenant policy
// leakage structurally impossible — no `forbid` guardrail is needed.
permit (
  principal,
  action,
  resource
) when {
  principal has "cognito:groups" &&
  principal["cognito:groups"].contains("tenant_admin")
};
