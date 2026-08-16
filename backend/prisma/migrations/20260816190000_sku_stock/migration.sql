-- CreateTable
CREATE TABLE "RoundSkuStock" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "skuKey" TEXT NOT NULL,
    "selections" JSONB NOT NULL,
    "stock" INTEGER NOT NULL,

    CONSTRAINT "RoundSkuStock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoundSkuStock_roundId_skuKey_key" ON "RoundSkuStock"("roundId", "skuKey");

-- CreateIndex
CREATE INDEX "RoundSkuStock_roundId_idx" ON "RoundSkuStock"("roundId");

-- AddForeignKey
ALTER TABLE "RoundSkuStock" ADD CONSTRAINT "RoundSkuStock_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "ProductRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "RoundOptionPrice" DROP COLUMN IF EXISTS "stock";
