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
// NOTE: driver is deliberately NOT granted ReadReportingDataset. Its ListMoves
// grant is a coarse "may open the Moves feature" gate whose real scoping is a
// handler-level DB filter (handlers/moves.ts scopes a driver to their own crew
// assignments and fails closed for an unlinked one). Reporting datasets key off
// the Cedar action alone, so a driver holding report:read would read
// TENANT-WIDE move aggregates via moves-by-status / the longhaul views --
// bypassing the row scoping every other driver-facing path enforces. Only grant
// this action to personas whose Cedar action fully describes their data scope.
permit (
  principal in Pegasus::Group::"driver",
  action in [Pegasus::Action::"ListMoves"],
  resource
);
