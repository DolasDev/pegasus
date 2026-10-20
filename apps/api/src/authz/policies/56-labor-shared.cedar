// labor (shared): every authenticated tenant user may keep a private book of
// cash-labor crews. There is no tenant data to gate by role here: the handler
// (handlers/labor.ts) only ever reads and writes through the CALLER'S OWN
// crew links, so a user can reach nothing they did not add themselves.
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
