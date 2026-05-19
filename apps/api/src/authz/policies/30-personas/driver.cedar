// driver: a crew member with a tenant login.
// Coarse - may open the Moves list feature. Per-row scoping to their own
// trips is a DB filter in the handler (Cedar cannot evaluate a collection).
permit (
  principal in Pegasus::Group::"driver",
  action in [Pegasus::Action::"ListMoves"],
  resource
);
// Per-record - may read one move only when their linked crew member is
// assigned to it. The auditable ABAC rule. The `has` guards are required:
// accessing a missing optional attribute is an evaluation error (deny) and
// they also satisfy AVP STRICT-mode validation.
permit (
  principal in Pegasus::Group::"driver",
  action in [Pegasus::Action::"ReadMove"],
  resource
)
when {
  principal has crewMemberId &&
  resource has assignedCrewMembers &&
  resource.assignedCrewMembers.contains(principal.crewMemberId)
};
