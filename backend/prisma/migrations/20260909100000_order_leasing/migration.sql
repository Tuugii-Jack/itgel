-- CreateEnum
ALTER TYPE "AdminRole" ADD VALUE 'LEASING';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "isLeasing" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "leasingFee" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Order_isLeasing_createdAt_idx" ON "Order"("isLeasing", "createdAt");
