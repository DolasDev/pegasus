// move chat (shared): every authenticated tenant user may read and post in move
// chat rooms, regardless of role. Which rooms is NOT decided here: the handler
// (handlers/chat.ts, lib/chat-access.ts) lets employees into every room and
// driver-scoped logins only into the moves they are assigned to.
//
// Chat is mounted on the Cognito-only tenant router, so the API clients and
// service accounts this unconstrained principal also matches can't reach it.
//
// Unconstrained principal (no group) = all principals. Top level (not under
// 30-personas/) because it is cross-role; one static policy per file (AVP).
permit (
  principal,
  action in [Pegasus::Action::"ReadChat", Pegasus::Action::"PostChat"],
  resource
);
