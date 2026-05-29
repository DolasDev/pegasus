// driver: a crew member with a tenant login.
// Coarse - may open the Moves list feature. Per-row scoping to their own
// trips is a DB filter in the handler (Cedar cannot evaluate a collection).
//
// NOTE: this file holds only the coarse ListMoves grant. The driver's
// per-record ReadMove ABAC rule lives in ../40-driver-crew-scoped-read-move.cedar
// because AVP CreatePolicy treats each .cedar file as a SINGLE static policy
// (two `permit` statements in one file fail validation with "unexpected token
// permit"), and the role-options drift test pins every 30-personas/*.cedar
// filename 1:1 to a persona name, so the second grant cannot live here.
permit (
  principal in Pegasus::Group::"driver",
  action in [Pegasus::Action::"ListMoves"],
  resource
);
