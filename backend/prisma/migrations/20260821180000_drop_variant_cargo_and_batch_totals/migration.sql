-- Сонголт бүрийн карго болон багцын нийлбэр талбаруудыг хасна.
DROP TABLE IF EXISTS "RoundCargoFee";

ALTER TABLE "Batch" DROP COLUMN IF EXISTS "itemQty";
ALTER TABLE "Batch" DROP COLUMN IF EXISTS "cargoTotal";
