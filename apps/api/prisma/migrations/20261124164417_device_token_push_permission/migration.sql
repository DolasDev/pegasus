-- CreateEnum
CREATE TYPE "PushPermission" AS ENUM ('GRANTED', 'LIMITED', 'ASKABLE', 'BLOCKED', 'CHANNEL_OFF');

-- AlterTable
ALTER TABLE "device_tokens" ADD COLUMN     "push_permission" "PushPermission";
