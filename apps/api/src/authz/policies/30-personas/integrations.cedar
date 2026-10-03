// integrations: read + write on the M2M surfaces (Order, Event). Replaces the
// prior `orders:write` / `events:write` scope set used by tenant-defined API
// clients. Service accounts that ingest events or push orders get this group.
// ReadRingCentralAttachment lets an on-prem client (pegII) fetch an MMS image by
// the reference forwarded into dbo.inbound_message_attachments.
permit (
  principal in Pegasus::Group::"integrations",
  action in [
    Pegasus::Action::"ReadOrder",
    Pegasus::Action::"CreateOrder",
    Pegasus::Action::"ReadEvent",
    Pegasus::Action::"CreateEvent",
    Pegasus::Action::"UpdateEvent",
    Pegasus::Action::"DeleteEvent",
    Pegasus::Action::"EmitTenantEvent",
    Pegasus::Action::"ReadRingCentralAttachment"
  ],
  resource
);
