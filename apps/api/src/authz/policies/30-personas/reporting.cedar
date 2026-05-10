// reporting: read-only across every operational entity, including the M2M
// surfaces (Order, Event). Intended for service accounts that mirror data into
// downstream warehouses or run scheduled exports — strictly observational.
permit (
  principal in Pegasus::Group::"reporting",
  action in [
    Pegasus::Action::"ReadQuote",
    Pegasus::Action::"ReadMove",
    Pegasus::Action::"ReadInvoice",
    Pegasus::Action::"ReadCustomer",
    Pegasus::Action::"ReadOrder",
    Pegasus::Action::"ReadEvent"
  ],
  resource
);
