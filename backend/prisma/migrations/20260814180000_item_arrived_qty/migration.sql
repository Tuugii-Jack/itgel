-- Хэсэгчилсэн ирэлт: мөр бүрд хэдэн ширхэг ирснийг хадгална.
ALTER TABLE "OrderItem" ADD COLUMN "arrivedQty" INTEGER NOT NULL DEFAULT 0;

-- Өмнө arrivedAt тавигдсан мөр бүтнээр ирсэн гэж үзнэ.
UPDATE "OrderItem" SET "arrivedQty" = "qty" WHERE "arrivedAt" IS NOT NULL AND "arrivedQty" = 0;
