-- CreateEnum
CREATE TYPE "FeedbackFormStatus" AS ENUM ('PUBLISHED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "FeedbackRequestStatus" AS ENUM ('PENDING', 'SUBMITTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "feedback_forms" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "form_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "FeedbackFormStatus" NOT NULL DEFAULT 'PUBLISHED',
    "title" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "message_template" TEXT,
    "published_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "form_key" TEXT NOT NULL,
    "form_version" INTEGER NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "status" "FeedbackRequestStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "responded_at" TIMESTAMP(3),
    "response_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_forms_tenant_id_form_key_status_idx" ON "feedback_forms"("tenant_id", "form_key", "status");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_forms_tenant_id_form_key_version_key" ON "feedback_forms"("tenant_id", "form_key", "version");

-- CreateIndex
CREATE INDEX "feedback_requests_token_prefix_idx" ON "feedback_requests"("token_prefix");

-- CreateIndex
CREATE INDEX "feedback_requests_tenant_id_status_created_at_idx" ON "feedback_requests"("tenant_id", "status", "created_at");
