// tenant_admin: full access to every action and every resource in this tenant
// store. The per-tenant policy store boundary makes cross-tenant policy
// leakage structurally impossible — no `forbid` guardrail is needed.
permit (
  principal in Pegasus::Group::"tenant_admin",
  action,
  resource
);
