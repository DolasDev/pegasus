-- Migration: 0004_sso_providers
-- Replace the ssoProviderConfig JSON blob on tenants with a dedicated
-- TenantSsoProvider relation table. This gives proper relational integrity,
-- individual row-level enable/disable, and a clean place to store sensitive
-- ARN references without ever mixing them with display metadata.

-- Create the SsoProviderType enum
CREATE TYPE "public"."SsoProviderType" AS ENUM ('OIDC', 'SAML');

-- Create the tenant_sso_providers table
CREATE TABLE "public"."tenant_sso_providers" (
    "id"                    UUID         NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id"             UUID         NOT NULL,
    "name"                  TEXT         NOT NULL,
    "type"                  "public"."SsoProviderType" NOT NULL,
    "cognito_provider_name" TEXT         NOT NULL,
    "metadata_url"          TEXT,
    "oidc_client_id"        TEXT,
    "secret_arn"            TEXT,
    "is_enabled"            BOOLEAN      NOT NULL DEFAULT true,
    "created_at"            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "updated_at"            TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "tenant_sso_providers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tenant_sso_providers_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- Unique: a Cognito provider name must be unique within a tenant
CREATE UNIQUE INDEX "tenant_sso_providers_tenant_id_cognito_provider_name_key"
    ON "public"."tenant_sso_providers"("tenant_id", "cognito_provider_name");

-- Index for tenant-scoped list queries
CREATE INDEX "tenant_sso_providers_tenant_id_idx"
    ON "public"."tenant_sso_providers"("tenant_id");

-- Drop the now-superseded JSON blob from tenants.
-- The column was only used as a Phase 2 placeholder and was never populated
-- in any production migration seed — safe to drop immediately.
ALTER TABLE "public"."tenants" DROP COLUMN IF EXISTS "sso_provider_config";
