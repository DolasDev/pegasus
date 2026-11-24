// support (shared): every authenticated tenant user may open, read and post in
// their OWN support threads with the platform operator, regardless of role.
// Which threads is NOT decided here: the handler (handlers/support.ts) serves
// only threads the caller opened and answers 404 for anyone else's.
//
// Support is mounted on the Cognito-only tenant router, and the handler also
// refuses an apiClient caller, so the API clients and service accounts this
// unconstrained principal also matches can't reach it.
//
// Unconstrained principal (no group) = all principals. Top level (not under
// 30-personas/) because it is cross-role; one static policy per file (AVP).
permit (
  principal,
  action in [Pegasus::Action::"ReadSupport", Pegasus::Action::"PostSupport"],
  resource
);
