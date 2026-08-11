// sales: owns the lead-to-quote pipeline. Full quote and customer authoring,
// read-only on the downstream operational moves.
permit (
  principal in Pegasus::Group::"sales",
  action in [
    Pegasus::Action::"ReadQuote",
    Pegasus::Action::"CreateQuote",
    Pegasus::Action::"UpdateQuote",
    Pegasus::Action::"ReadCustomer",
    Pegasus::Action::"CreateCustomer",
    Pegasus::Action::"UpdateCustomer",
    Pegasus::Action::"ListMoves",
    Pegasus::Action::"ReadMove",
    Pegasus::Action::"ReadReportingDataset"
  ],
  resource
);
