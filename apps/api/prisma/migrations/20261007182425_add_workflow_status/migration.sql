-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- AlterTable
ALTER TABLE "workflows" ADD COLUMN     "retired_at" TIMESTAMP(3),
ADD COLUMN     "retired_by_user_id" TEXT,
ADD COLUMN     "status" "WorkflowStatus" NOT NULL DEFAULT 'ACTIVE';
