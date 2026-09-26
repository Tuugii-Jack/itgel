-- Additive: existing batches keep all qty/order/cargo data.
ALTER TABLE "Batch" ADD COLUMN "cargoRef" TEXT;

CREATE TABLE "BatchArrivalNote" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "skuKey" TEXT NOT NULL DEFAULT '',
    "selections" JSONB NOT NULL DEFAULT '{}',
    "kind" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchArrivalNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BatchArrivalNote_batchId_idx" ON "BatchArrivalNote"("batchId");
CREATE INDEX "BatchArrivalNote_roundId_idx" ON "BatchArrivalNote"("roundId");

ALTER TABLE "BatchArrivalNote" ADD CONSTRAINT "BatchArrivalNote_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
