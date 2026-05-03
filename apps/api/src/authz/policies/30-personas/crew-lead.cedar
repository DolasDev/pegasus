// crew-lead: on-the-day operational view. Read assigned moves and customer
// detail so the crew leader can confirm logistics; update moves to record
// arrival/departure progress.
permit (
  principal in Pegasus::Group::"crew_lead",
  action in [
    Pegasus::Action::"ReadMove",
    Pegasus::Action::"UpdateMove",
    Pegasus::Action::"ReadCustomer"
  ],
  resource
);
