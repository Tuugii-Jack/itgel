-- Лизингийн холбоо барих, бэлэн барааны нөөц, карго/тооцооны бүртгэл.

ALTER TABLE "ProductRound"
  ADD COLUMN IF NOT EXISTS "reserved" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "available" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "RoundSkuStock"
  ADD COLUMN IF NOT EXISTS "reserved" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "available" INTEGER NOT NULL DEFAULT 0;

UPDATE "RoundSkuStock" SET "available" = GREATEST(0, "stock" - "reserved");
UPDATE "ProductRound" SET "available" = GREATEST(0, "stock" - "reserved");

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "shopPaidAmount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "qpayCargoInvoiceId" TEXT;

ALTER TABLE "OrderItem"
  ADD COLUMN IF NOT EXISTS "stockHold" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "stockShortfall" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "payeeKind" "InventoryOwner";

ALTER TABLE "QpayInvoice"
  ALTER COLUMN "orderId" DROP NOT NULL;

ALTER TABLE "QpayInvoice"
  ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'ORDER',
  ADD COLUMN IF NOT EXISTS "amount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "settlementPaymentId" TEXT;

ALTER TABLE "Setting"
  ADD COLUMN IF NOT EXISTS "leasingPublicName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "leasingContactPhone" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "leasingChatUrl" TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "ItgelSettlement" (
  "id" TEXT NOT NULL,
  "sourceOrderItemId" TEXT NOT NULL,
  "sourceOrderId" TEXT NOT NULL,
  "sourceOrderCode" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "customerName" TEXT NOT NULL DEFAULT '',
  "ownerAdminId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "roundId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "qty" INTEGER NOT NULL,
  "unitPrice" INTEGER NOT NULL,
  "amount" INTEGER NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "paidAmount" INTEGER NOT NULL DEFAULT 0,
  "remainingAmount" INTEGER NOT NULL,
  "lockPaymentId" TEXT,
  "readyTransferId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ItgelSettlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ItgelSettlementPayment" (
  "id" TEXT NOT NULL,
  "ownerAdminId" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "qpayInvoiceId" TEXT,
  "bankRef" TEXT,
  "bankDate" TIMESTAMP(3),
  "receiptUrl" TEXT,
  "claimedBy" TEXT NOT NULL,
  "confirmedBy" TEXT,
  "rejectedReason" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ItgelSettlementPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ItgelSettlementPaymentLine" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,

  CONSTRAINT "ItgelSettlementPaymentLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MoneyException" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "orderId" TEXT,
  "settlementPaymentId" TEXT,
  "qpayInvoiceId" TEXT,
  "amount" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "note" TEXT,
  "actor" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedBy" TEXT,

  CONSTRAINT "MoneyException_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ItgelSettlement_sourceOrderItemId_key"
  ON "ItgelSettlement"("sourceOrderItemId");

CREATE INDEX IF NOT EXISTS "ItgelSettlement_ownerAdminId_confirmedAt_idx"
  ON "ItgelSettlement"("ownerAdminId", "confirmedAt");

CREATE INDEX IF NOT EXISTS "ItgelSettlement_status_confirmedAt_idx"
  ON "ItgelSettlement"("status", "confirmedAt");

CREATE INDEX IF NOT EXISTS "ItgelSettlement_sourceOrderId_idx"
  ON "ItgelSettlement"("sourceOrderId");

CREATE INDEX IF NOT EXISTS "ItgelSettlement_lockPaymentId_idx"
  ON "ItgelSettlement"("lockPaymentId");

CREATE UNIQUE INDEX IF NOT EXISTS "ItgelSettlementPayment_qpayInvoiceId_key"
  ON "ItgelSettlementPayment"("qpayInvoiceId");

CREATE INDEX IF NOT EXISTS "ItgelSettlementPayment_ownerAdminId_createdAt_idx"
  ON "ItgelSettlementPayment"("ownerAdminId", "createdAt");

CREATE INDEX IF NOT EXISTS "ItgelSettlementPayment_status_createdAt_idx"
  ON "ItgelSettlementPayment"("status", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "ItgelSettlementPaymentLine_paymentId_settlementId_key"
  ON "ItgelSettlementPaymentLine"("paymentId", "settlementId");

CREATE INDEX IF NOT EXISTS "ItgelSettlementPaymentLine_settlementId_idx"
  ON "ItgelSettlementPaymentLine"("settlementId");

CREATE INDEX IF NOT EXISTS "MoneyException_status_createdAt_idx"
  ON "MoneyException"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "MoneyException_orderId_idx"
  ON "MoneyException"("orderId");

CREATE INDEX IF NOT EXISTS "MoneyException_kind_status_idx"
  ON "MoneyException"("kind", "status");

CREATE INDEX IF NOT EXISTS "ProductRound_closeAt_available_idx"
  ON "ProductRound"("closeAt", "available");

CREATE INDEX IF NOT EXISTS "OrderItem_stockHold_idx"
  ON "OrderItem"("stockHold");

CREATE INDEX IF NOT EXISTS "QpayInvoice_purpose_createdAt_idx"
  ON "QpayInvoice"("purpose", "createdAt");

CREATE INDEX IF NOT EXISTS "QpayInvoice_settlementPaymentId_idx"
  ON "QpayInvoice"("settlementPaymentId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ItgelSettlement_sourceOrderItemId_fkey'
  ) THEN
    ALTER TABLE "ItgelSettlement"
      ADD CONSTRAINT "ItgelSettlement_sourceOrderItemId_fkey"
      FOREIGN KEY ("sourceOrderItemId") REFERENCES "OrderItem"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ItgelSettlement_sourceOrderId_fkey'
  ) THEN
    ALTER TABLE "ItgelSettlement"
      ADD CONSTRAINT "ItgelSettlement_sourceOrderId_fkey"
      FOREIGN KEY ("sourceOrderId") REFERENCES "Order"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ItgelSettlement_readyTransferId_fkey'
  ) THEN
    ALTER TABLE "ItgelSettlement"
      ADD CONSTRAINT "ItgelSettlement_readyTransferId_fkey"
      FOREIGN KEY ("readyTransferId") REFERENCES "ReadyStockTransfer"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ItgelSettlementPaymentLine_paymentId_fkey'
  ) THEN
    ALTER TABLE "ItgelSettlementPaymentLine"
      ADD CONSTRAINT "ItgelSettlementPaymentLine_paymentId_fkey"
      FOREIGN KEY ("paymentId") REFERENCES "ItgelSettlementPayment"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ItgelSettlementPaymentLine_settlementId_fkey'
  ) THEN
    ALTER TABLE "ItgelSettlementPaymentLine"
      ADD CONSTRAINT "ItgelSettlementPaymentLine_settlementId_fkey"
      FOREIGN KEY ("settlementId") REFERENCES "ItgelSettlement"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MoneyException_orderId_fkey'
  ) THEN
    ALTER TABLE "MoneyException"
      ADD CONSTRAINT "MoneyException_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MoneyException_settlementPaymentId_fkey'
  ) THEN
    ALTER TABLE "MoneyException"
      ADD CONSTRAINT "MoneyException_settlementPaymentId_fkey"
      FOREIGN KEY ("settlementPaymentId") REFERENCES "ItgelSettlementPayment"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'QpayInvoice_settlementPaymentId_fkey'
  ) THEN
    ALTER TABLE "QpayInvoice"
      ADD CONSTRAINT "QpayInvoice_settlementPaymentId_fkey"
      FOREIGN KEY ("settlementPaymentId") REFERENCES "ItgelSettlementPayment"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
