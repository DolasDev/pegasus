// integrations: read + write on the M2M surfaces (Order, Event). Replaces the
// prior `orders:write` / `events:write` scope set used by tenant-defined API
// clients. Service accounts that ingest events or push orders get this group.
permit (
  principal in Pegasus::Group::"integrations",
  action in [
    Pegasus::Action::"ReadOrder",
    Pegasus::Action::"CreateOrder",
    Pegasus::Action::"ReadEvent",
    Pegasus::Action::"CreateEvent",
    Pegasus::Action::"UpdateEvent",
    Pegasus::Action::"DeleteEvent"
  ],
  resource
);
