// documents (shared): every authenticated tenant user may read and upload
// documents, regardless of role. Delete/archive is NOT granted here -- it is
// restricted to the billing/accounting roles and tenant_admin (see
// 30-personas/accountant.cedar, 30-personas/billing-manager.cedar, and the
// permit-everything 10-tenant-admin.cedar).
//
// Unconstrained principal (no group) = all principals. This lives at the top
// level (not under 30-personas/) because it is cross-role, and AVP CreatePolicy
// allows only one static policy per file.
permit (
  principal,
  action in [Pegasus::Action::"ReadDocument", Pegasus::Action::"UploadDocument"],
  resource
);
