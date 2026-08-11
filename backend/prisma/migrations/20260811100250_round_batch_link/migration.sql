-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "deadline" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProductRound" ADD COLUMN     "batchId" TEXT;

-- CreateIndex
CREATE INDEX "ProductRound_batchId_idx" ON "ProductRound"("batchId");

-- AddForeignKey
ALTER TABLE "ProductRound" ADD CONSTRAINT "ProductRound_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
