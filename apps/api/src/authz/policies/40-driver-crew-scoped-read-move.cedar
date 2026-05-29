// driver (per-record): may read one move only when their linked crew member
// is assigned to it. The auditable ABAC rule. The `has` guards are required:
// accessing a missing optional attribute is an evaluation error (deny) and
// they also satisfy AVP STRICT-mode validation.
//
// This is the driver persona's second grant. It lives outside 30-personas/
// (and so is excluded from the role-options drift test, which maps each
// 30-personas/*.cedar filename to a persona name) because AVP CreatePolicy
// allows only ONE static policy statement per .cedar file. The coarse
// ListMoves grant is in 30-personas/driver.cedar. The recursive loadPolicies()
// glob still picks this file up, so both the offline cedar-wasm backend and
// the AVP reconciler see it.
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
