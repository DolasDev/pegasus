// ---------------------------------------------------------------------------
// Shared schema-ensure SQL for the DriverConfirmedAvailability table.
//
// Both the read (driver-planning.ts) and write (driver-planning-patch.ts)
// cloud-direct handlers persist planner-maintained driver overrides in this
// table. The on-prem repo lazily CREATEs it when absent (ensureConfirmedTable);
// we mirror that, but the table now also carries Variant-B roster columns
// (canada/california/rating/equipment/home_city/home_state) added after the
// original notes feature shipped. The CREATE guard only fires when the table is
// ABSENT, so on tenants whose table predates these columns we additionally run
// idempotent `IF COL_LENGTH … IS NULL ALTER TABLE … ADD` guards. Prefixing this
// to the read SELECT keeps that query safe (otherwise selecting a not-yet-added
// column would hit the soft-fail path and blank out ALL overrides, incl. notes).
// ---------------------------------------------------------------------------

export const ENSURE_CONFIRMED_TABLE_SQL = `
SET XACT_ABORT ON;
IF OBJECT_ID('DriverConfirmedAvailability', 'U') IS NULL
  CREATE TABLE DriverConfirmedAvailability (
    driver_id int NOT NULL PRIMARY KEY,
    confirmed_date varchar(50) NULL,
    confirmed_location varchar(255) NULL,
    notes varchar(1000) NULL,
    canada bit NULL,
    california bit NULL,
    rating decimal(3,2) NULL,
    equipment varchar(50) NULL,
    home_city varchar(100) NULL,
    home_state varchar(50) NULL,
    updated_by int NULL,
    updated_at datetime NULL DEFAULT GETDATE()
  );
ELSE
BEGIN
  IF COL_LENGTH('DriverConfirmedAvailability','canada')     IS NULL ALTER TABLE DriverConfirmedAvailability ADD canada bit NULL;
  IF COL_LENGTH('DriverConfirmedAvailability','california') IS NULL ALTER TABLE DriverConfirmedAvailability ADD california bit NULL;
  IF COL_LENGTH('DriverConfirmedAvailability','rating')     IS NULL ALTER TABLE DriverConfirmedAvailability ADD rating decimal(3,2) NULL;
  IF COL_LENGTH('DriverConfirmedAvailability','equipment')  IS NULL ALTER TABLE DriverConfirmedAvailability ADD equipment varchar(50) NULL;
  IF COL_LENGTH('DriverConfirmedAvailability','home_city')  IS NULL ALTER TABLE DriverConfirmedAvailability ADD home_city varchar(100) NULL;
  IF COL_LENGTH('DriverConfirmedAvailability','home_state') IS NULL ALTER TABLE DriverConfirmedAvailability ADD home_state varchar(50) NULL;
END
`
