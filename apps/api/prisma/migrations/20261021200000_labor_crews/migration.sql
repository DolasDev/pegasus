-- CreateTable
CREATE TABLE "labor_crews" (
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "updated_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labor_crews_pkey" PRIMARY KEY ("phone")
);

-- CreateTable
CREATE TABLE "labor_crew_links" (
    "id" TEXT NOT NULL,
    "tenant_user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "crew_phone" TEXT NOT NULL,
    "nickname" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labor_crew_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labor_crew_service_areas" (
    "id" TEXT NOT NULL,
    "crew_phone" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "city_key" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "geo_city_id" TEXT,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labor_crew_service_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labor_packers" (
    "id" TEXT NOT NULL,
    "crew_phone" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "cid_number" TEXT,
    "cid_issued_on" DATE,
    "phone" TEXT,
    "cid_key" TEXT,
    "email_key" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "updated_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labor_packers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labor_crew_ratings" (
    "id" TEXT NOT NULL,
    "crew_link_id" TEXT NOT NULL,
    "stars" SMALLINT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labor_crew_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geo_cities" (
    "id" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "region" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "population" INTEGER,

    CONSTRAINT "geo_cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geo_postal_codes" (
    "country" CHAR(2) NOT NULL,
    "code" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "geo_postal_codes_pkey" PRIMARY KEY ("country","code")
);

-- CreateIndex
CREATE INDEX "labor_crew_links_crew_phone_idx" ON "labor_crew_links"("crew_phone");

-- CreateIndex
CREATE INDEX "labor_crew_links_tenant_user_id_created_at_idx" ON "labor_crew_links"("tenant_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "labor_crew_links_tenant_user_id_crew_phone_key" ON "labor_crew_links"("tenant_user_id", "crew_phone");

-- CreateIndex
CREATE UNIQUE INDEX "labor_crew_service_areas_crew_phone_country_region_city_key_key" ON "labor_crew_service_areas"("crew_phone", "country", "region", "city_key");

-- CreateIndex
CREATE INDEX "labor_packers_crew_phone_idx" ON "labor_packers"("crew_phone");

-- CreateIndex
CREATE UNIQUE INDEX "labor_packers_crew_phone_cid_key_key" ON "labor_packers"("crew_phone", "cid_key");

-- CreateIndex
CREATE UNIQUE INDEX "labor_packers_crew_phone_email_key_key" ON "labor_packers"("crew_phone", "email_key");

-- CreateIndex
CREATE UNIQUE INDEX "labor_crew_ratings_crew_link_id_key" ON "labor_crew_ratings"("crew_link_id");

-- CreateIndex
CREATE INDEX "geo_cities_name_key_idx" ON "geo_cities"("name_key");

-- CreateIndex
CREATE INDEX "geo_cities_country_region_idx" ON "geo_cities"("country", "region");

-- AddForeignKey
ALTER TABLE "labor_crew_links" ADD CONSTRAINT "labor_crew_links_tenant_user_id_fkey" FOREIGN KEY ("tenant_user_id") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_crew_links" ADD CONSTRAINT "labor_crew_links_crew_phone_fkey" FOREIGN KEY ("crew_phone") REFERENCES "labor_crews"("phone") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_crew_service_areas" ADD CONSTRAINT "labor_crew_service_areas_crew_phone_fkey" FOREIGN KEY ("crew_phone") REFERENCES "labor_crews"("phone") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_crew_service_areas" ADD CONSTRAINT "labor_crew_service_areas_geo_city_id_fkey" FOREIGN KEY ("geo_city_id") REFERENCES "geo_cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_packers" ADD CONSTRAINT "labor_packers_crew_phone_fkey" FOREIGN KEY ("crew_phone") REFERENCES "labor_crews"("phone") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_crew_ratings" ADD CONSTRAINT "labor_crew_ratings_crew_link_id_fkey" FOREIGN KEY ("crew_link_id") REFERENCES "labor_crew_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A rating is 1–5 whole stars (domain validateRating); the column is SMALLINT.
ALTER TABLE "labor_crew_ratings" ADD CONSTRAINT "labor_crew_ratings_stars_check" CHECK ("stars" BETWEEN 1 AND 5);
