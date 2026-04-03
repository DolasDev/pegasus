-- ---------------------------------------------------------------------------
-- Migration: 0003_tenant_email_domains
--
-- Adds an email_domains array to the tenants table so the auth API can
-- resolve which tenant owns a given email domain during SSO login.
--
-- A GIN index is created for fast array-containment queries of the form:
--   WHERE email_domains @> ARRAY['acme.com']
--
-- Phase 4 (tenant creation) will populate this column for new tenants.
-- Existing tenants start with an empty array and cannot use SSO until
-- an administrator configures their email domain.
-- ---------------------------------------------------------------------------

ALTER TABLE public.tenants
  ADD COLUMN "email_domains" TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX "tenants_email_domains_gin"
  ON public.tenants USING gin("email_domains");
