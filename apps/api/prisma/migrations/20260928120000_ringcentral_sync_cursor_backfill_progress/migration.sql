-- RingCentral v1 backfill progress (FSync returns at most 250 records; the rest is paged).
ALTER TABLE "ringcentral_sync_cursors" ADD COLUMN "backfill_from" TIMESTAMPTZ(6);
ALTER TABLE "ringcentral_sync_cursors" ADD COLUMN "backfill_before" TIMESTAMPTZ(6);
