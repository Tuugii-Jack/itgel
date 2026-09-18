-- Итгэлд төлөх хариуцагчийг тохиргоо + захиалгын snapshot-оор ил тод хадгална.
-- Эхний идэвхтэй LEASING админ руу буцахгүй. Хуучин захиалгад өр үүсгэхгүй.

ALTER TABLE "Setting"
  ADD COLUMN IF NOT EXISTS "leasingSettlementAdminId" TEXT;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "leasingOperatorAdminId" TEXT;

CREATE INDEX IF NOT EXISTS "Order_leasingOperatorAdminId_idx"
  ON "Order"("leasingOperatorAdminId");
