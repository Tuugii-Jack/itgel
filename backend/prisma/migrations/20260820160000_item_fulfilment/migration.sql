-- Ирсэн барааг мөр бүрээр очиж авах / хүргэлтээр авах.
ALTER TABLE "OrderItem" ADD COLUMN "fulfilment" "Fulfilment";

-- Хуучин захиалга: захиалгын авах аргыг зөвхөн ирсэн мөрөнд хуулна.
UPDATE "OrderItem" AS i
SET "fulfilment" = o."fulfilment"
FROM "Order" AS o
WHERE i."orderId" = o.id
  AND o."fulfilment" IS NOT NULL
  AND i."cancelledAt" IS NULL
  AND i."fulfilment" IS NULL
  AND (i."arrivedAt" IS NOT NULL OR i."arrivedQty" > 0);
