-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "handedOverAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "OrderItem_arrivedAt_idx" ON "OrderItem"("arrivedAt");

-- CreateIndex
CREATE INDEX "OrderItem_handedOverAt_idx" ON "OrderItem"("handedOverAt");

-- Backfill: аль хэдийн ирсэн/өгсөн захиалгын мөрүүд
UPDATE "OrderItem" AS oi
SET "arrivedAt" = o."arrivedAt"
FROM "Order" AS o
WHERE oi."orderId" = o.id
  AND oi."cancelledAt" IS NULL
  AND oi."arrivedAt" IS NULL
  AND o."arrivedAt" IS NOT NULL
  AND o.status IN ('ARRIVED', 'HANDED_OVER');

UPDATE "OrderItem" AS oi
SET
  "handedOverAt" = o."handedOverAt",
  "arrivedAt" = COALESCE(oi."arrivedAt", o."handedOverAt", o."arrivedAt")
FROM "Order" AS o
WHERE oi."orderId" = o.id
  AND oi."cancelledAt" IS NULL
  AND oi."handedOverAt" IS NULL
  AND o.status = 'HANDED_OVER'
  AND o."handedOverAt" IS NOT NULL;
