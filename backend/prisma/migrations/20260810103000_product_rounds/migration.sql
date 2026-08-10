-- Барааг «загвар» ба «тойрог» болгон салгана.
--
-- Гараар бичсэн: Prisma-гийн үүсгэсэн хувилбар нь Product-ын баганыг шууд
-- устгаад OrderItem.roundId-г хоосноор нэмэх тул одоо байгаа өгөгдөл алдагдана.
-- Энд эхлээд тойргуудыг үүсгэж, өгөгдлийг нүүлгээд, дараа нь л хуучныг хасна.

-- 1. Тойргийн хүснэгт.
CREATE TABLE "ProductRound" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "roundNo" INTEGER NOT NULL,
    "costPrice" INTEGER NOT NULL,
    "sellPrice" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "closeAt" TIMESTAMP(3),
    "leadMinDays" INTEGER NOT NULL DEFAULT 7,
    "leadMaxDays" INTEGER NOT NULL DEFAULT 14,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProductRound_pkey" PRIMARY KEY ("id")
);

-- 2. Одоо байгаа бараа бүрээс нэгдүгээр тойрог үүсгэнэ.
--    Тойргийн id нь uuid — Prisma-гийн cuid зөвхөн шинэ мөрөнд хэрэглэгдэнэ.
INSERT INTO "ProductRound" (
    "id", "productId", "roundNo", "costPrice", "sellPrice", "stock",
    "closeAt", "leadMinDays", "leadMaxDays", "status",
    "createdAt", "updatedAt", "deletedAt"
)
SELECT
    gen_random_uuid()::text,
    p."id",
    1,
    p."costPrice",
    p."sellPrice",
    p."stock",
    p."closeAt",
    p."leadMinDays",
    p."leadMaxDays",
    p."status",
    p."createdAt",
    p."updatedAt",
    p."deletedAt"
FROM "Product" p;

-- 3. Захиалгын мөрөнд шинэ баганууд — эхлээд хоосон зөвшөөрнө.
ALTER TABLE "OrderItem"
    ADD COLUMN "roundId" TEXT,
    ADD COLUMN "arriveFrom" TIMESTAMP(3),
    ADD COLUMN "arriveTo" TIMESTAMP(3);

-- 4. Мөр бүрийг барааныхаа цорын ганц тойрогтой холбоно.
UPDATE "OrderItem" oi
SET "roundId" = r."id"
FROM "ProductRound" r
WHERE r."productId" = oi."productId";

-- 5. Ирэх огнооны амлалтыг тухайн үеийн утгаар царцаана.
--    Энэ нь одоо код дээр бодогдож байгаа яг тэр утга (closeAt + хүлээх хоног).
--    Бэлэн бараанд (closeAt хоосон) огноо байхгүй — маргааш гарт очно.
UPDATE "OrderItem" oi
SET "arriveFrom" = r."closeAt" + (r."leadMinDays" * INTERVAL '1 day'),
    "arriveTo"   = r."closeAt" + (r."leadMaxDays" * INTERVAL '1 day')
FROM "ProductRound" r
WHERE r."id" = oi."roundId" AND r."closeAt" IS NOT NULL;

-- 6. Бүх мөр холбогдсоны дараа л заавал байхаар чангална.
ALTER TABLE "OrderItem" ALTER COLUMN "roundId" SET NOT NULL;

-- 7. Индекс, гадаад түлхүүрүүд.
CREATE UNIQUE INDEX "ProductRound_productId_roundNo_key" ON "ProductRound"("productId", "roundNo");
CREATE INDEX "ProductRound_status_idx" ON "ProductRound"("status");
CREATE INDEX "ProductRound_closeAt_idx" ON "ProductRound"("closeAt");
CREATE INDEX "ProductRound_productId_createdAt_idx" ON "ProductRound"("productId", "createdAt");
CREATE INDEX "OrderItem_roundId_idx" ON "OrderItem"("roundId");

ALTER TABLE "ProductRound" ADD CONSTRAINT "ProductRound_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_roundId_fkey"
    FOREIGN KEY ("roundId") REFERENCES "ProductRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 8. Өгөгдөл бүрэн нүүсний дараа хуучин баганыг хасна.
DROP INDEX "Product_closeAt_idx";
DROP INDEX "Product_status_idx";

ALTER TABLE "Product"
    DROP COLUMN "closeAt",
    DROP COLUMN "costPrice",
    DROP COLUMN "leadMaxDays",
    DROP COLUMN "leadMinDays",
    DROP COLUMN "sellPrice",
    DROP COLUMN "status",
    DROP COLUMN "stock";
