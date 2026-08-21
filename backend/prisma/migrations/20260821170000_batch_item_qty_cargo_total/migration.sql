-- Багц дээр нийт ширхэг болон каргог нэгтгэж хадгална.
ALTER TABLE "Batch" ADD COLUMN IF NOT EXISTS "itemQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Batch" ADD COLUMN IF NOT EXISTS "cargoTotal" INTEGER NOT NULL DEFAULT 0;

UPDATE "Batch" b
SET "itemQty" = COALESCE((
  SELECT SUM(oi."qty")::int
  FROM "OrderItem" oi
  JOIN "Order" o ON o."id" = oi."orderId"
  JOIN "ProductRound" pr ON pr."id" = oi."roundId"
  WHERE pr."batchId" = b."id"
    AND pr."deletedAt" IS NULL
    AND oi."cancelledAt" IS NULL
    AND o."deletedAt" IS NULL
    AND o."status" <> 'CANCELLED'
    AND o."batchOmittedAt" IS NULL
    AND o."batchId" = b."id"
), 0);

UPDATE "Batch" b
SET "cargoTotal" = COALESCE((
  SELECT SUM(o."cargoFee")::int
  FROM "Order" o
  WHERE o."batchId" = b."id"
    AND o."deletedAt" IS NULL
    AND o."status" <> 'CANCELLED'
    AND o."batchOmittedAt" IS NULL
), 0);
