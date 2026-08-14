-- Багцын бараанд нэгж карго үнэ, захиалгад нийлбэр карго.
ALTER TABLE "ProductRound" ADD COLUMN IF NOT EXISTS "cargoFee" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cargoFee" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cargoPayMethod" TEXT;
