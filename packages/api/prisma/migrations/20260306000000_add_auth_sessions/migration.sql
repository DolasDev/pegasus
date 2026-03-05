-- CreateTable
CREATE TABLE "public"."auth_sessions" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_sessions_email_idx" ON "public"."auth_sessions"("email");
