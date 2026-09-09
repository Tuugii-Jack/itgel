-- AlterTable
ALTER TABLE "Setting" ADD COLUMN "leasingPayGaps" JSONB NOT NULL DEFAULT '[5,8,8]';
