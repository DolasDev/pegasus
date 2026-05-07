// dispatcher: owns the operational record of moves. Read everything
// operational, write moves and customer detail captured at dispatch time.
permit (
  principal,
  action in [
    Pegasus::Action::"ReadMove",
    Pegasus::Action::"CreateMove",
    Pegasus::Action::"UpdateMove",
    Pegasus::Action::"ReadCustomer",
    Pegasus::Action::"UpdateCustomer",
    Pegasus::Action::"ReadQuote"
  ],
  resource
) when {
  principal has "cognito:groups" &&
  principal["cognito:groups"].contains("dispatcher")
};
