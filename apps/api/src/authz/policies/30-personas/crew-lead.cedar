// crew-lead: on-the-day operational view. Read assigned moves and customer
// detail so the crew leader can confirm logistics; update moves to record
// arrival/departure progress.
permit (
  principal,
  action in [
    Pegasus::Action::"ReadMove",
    Pegasus::Action::"UpdateMove",
    Pegasus::Action::"ReadCustomer"
  ],
  resource
) when {
  principal has "cognito:groups" &&
  principal["cognito:groups"].contains("crew_lead")
};
