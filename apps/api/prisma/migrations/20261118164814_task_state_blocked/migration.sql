-- AlterTable
ALTER TABLE "task_states" ADD COLUMN     "block_reason" VARCHAR(500),
ADD COLUMN     "blocked_at" TIMESTAMPTZ(6);
