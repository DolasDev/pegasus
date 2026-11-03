// labor (shared): every authenticated tenant user may keep a private book of
// cash-labor crews and use their tenant's company crew list. There is no
// tenant data to gate by role here: the handler (handlers/labor.ts) only ever
// reads and writes through the CALLER'S OWN crew links or their own tenant's
// company list. The one role rule - only an Operations role may remove a crew
// from the company list or create one onto it by phone - is enforced in the
// handler by role name (OPERATIONS_ROLES), like the longhaul reads, because the
// dispatcher personas are deliberate placeholders that grant nothing.
//
// Labor is mounted on the Cognito-only tenant router and refuses an apiClient
// caller, so the API clients and service accounts this unconstrained principal
// also matches can't reach it.
//
// Unconstrained principal (no group) = all principals. Top level (not under
// 30-personas/) because it is cross-role; one static policy per file (AVP).
permit (
  principal,
  action in [Pegasus::Action::"ReadLabor", Pegasus::Action::"WriteLabor"],
  resource
);
