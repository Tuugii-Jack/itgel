-- Лизингийн админы эзэмшлийн бэлэн бараа, өрийн хаалт, дахин борлуулалтын төлбөр.

DO $$ BEGIN
  CREATE TYPE "InventoryOwner" AS ENUM ('SHOP', 'LEASING');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "ownerKind" "InventoryOwner" NOT NULL DEFAULT 'SHOP',
  ADD COLUMN IF NOT EXISTS "ownerAdminId" TEXT;

ALTER TABLE "ProductRound"
  ADD COLUMN IF NOT EXISTS "ownerKind" "InventoryOwner" NOT NULL DEFAULT 'SHOP',
  ADD COLUMN IF NOT EXISTS "ownerAdminId" TEXT;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "payeeKind" "InventoryOwner" NOT NULL DEFAULT 'SHOP',
  ADD COLUMN IF NOT EXISTS "writtenOffAmount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "debtClosedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "debtCloseReason" TEXT;

ALTER TABLE "OrderItem"
  ADD COLUMN IF NOT EXISTS "transferredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "transferredQty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "readyTransferId" TEXT;

ALTER TABLE "Setting"
  ADD COLUMN IF NOT EXISTS "leasingBankName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "leasingBankAccountNumber" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "leasingBankAccountName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "leasingPaymentNote" TEXT NOT NULL DEFAULT '';

UPDATE "Order"
SET "payeeKind" = 'LEASING'
WHERE "isLeasing" = true
  AND "payeeKind" = 'SHOP';

CREATE TABLE IF NOT EXISTS "ReadyStockTransfer" (
  "id" TEXT NOT NULL,
  "sourceOrderId" TEXT NOT NULL,
  "ownerAdminId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "paidKeptAmount" INTEGER NOT NULL,
  "dueClosedAmount" INTEGER NOT NULL,
  "wroteOffDebt" BOOLEAN NOT NULL DEFAULT false,
  "remainingActiveQty" INTEGER NOT NULL DEFAULT 0,
  "actor" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReadyStockTransfer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ReadyStockTransferLine" (
  "id" TEXT NOT NULL,
  "transferId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "sourceRoundId" TEXT NOT NULL,
  "destProductId" TEXT NOT NULL,
  "destRoundId" TEXT NOT NULL,
  "qty" INTEGER NOT NULL,
  "resaleUnitPrice" INTEGER NOT NULL,
  "nameSnapshot" TEXT NOT NULL,
  "selections" JSONB NOT NULL DEFAULT '{}',

  CONSTRAINT "ReadyStockTransferLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Product_ownerKind_ownerAdminId_idx"
  ON "Product"("ownerKind", "ownerAdminId");

CREATE INDEX IF NOT EXISTS "ProductRound_ownerKind_ownerAdminId_idx"
  ON "ProductRound"("ownerKind", "ownerAdminId");

CREATE INDEX IF NOT EXISTS "Order_payeeKind_createdAt_idx"
  ON "Order"("payeeKind", "createdAt");

CREATE INDEX IF NOT EXISTS "Order_debtClosedAt_idx"
  ON "Order"("debtClosedAt");

CREATE INDEX IF NOT EXISTS "OrderItem_readyTransferId_idx"
  ON "OrderItem"("readyTransferId");

CREATE INDEX IF NOT EXISTS "OrderItem_transferredAt_idx"
  ON "OrderItem"("transferredAt");

CREATE INDEX IF NOT EXISTS "ReadyStockTransfer_sourceOrderId_idx"
  ON "ReadyStockTransfer"("sourceOrderId");

CREATE INDEX IF NOT EXISTS "ReadyStockTransfer_ownerAdminId_createdAt_idx"
  ON "ReadyStockTransfer"("ownerAdminId", "createdAt");

CREATE INDEX IF NOT EXISTS "ReadyStockTransferLine_transferId_idx"
  ON "ReadyStockTransferLine"("transferId");

CREATE INDEX IF NOT EXISTS "ReadyStockTransferLine_destRoundId_idx"
  ON "ReadyStockTransferLine"("destRoundId");

CREATE INDEX IF NOT EXISTS "ReadyStockTransferLine_orderItemId_idx"
  ON "ReadyStockTransferLine"("orderItemId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ReadyStockTransfer_sourceOrderId_fkey'
  ) THEN
    ALTER TABLE "ReadyStockTransfer"
      ADD CONSTRAINT "ReadyStockTransfer_sourceOrderId_fkey"
      FOREIGN KEY ("sourceOrderId") REFERENCES "Order"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ReadyStockTransferLine_transferId_fkey'
  ) THEN
    ALTER TABLE "ReadyStockTransferLine"
      ADD CONSTRAINT "ReadyStockTransferLine_transferId_fkey"
      FOREIGN KEY ("transferId") REFERENCES "ReadyStockTransfer"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ReadyStockTransferLine_destProductId_fkey'
  ) THEN
    ALTER TABLE "ReadyStockTransferLine"
      ADD CONSTRAINT "ReadyStockTransferLine_destProductId_fkey"
      FOREIGN KEY ("destProductId") REFERENCES "Product"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ReadyStockTransferLine_destRoundId_fkey'
  ) THEN
    ALTER TABLE "ReadyStockTransferLine"
      ADD CONSTRAINT "ReadyStockTransferLine_destRoundId_fkey"
      FOREIGN KEY ("destRoundId") REFERENCES "ProductRound"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderItem_readyTransferId_fkey'
  ) THEN
    ALTER TABLE "OrderItem"
      ADD CONSTRAINT "OrderItem_readyTransferId_fkey"
      FOREIGN KEY ("readyTransferId") REFERENCES "ReadyStockTransfer"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
