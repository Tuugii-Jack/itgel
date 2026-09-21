-- Итгэлд төлөх: төлбөрийн анхны баталгааны огноо, QPay нэхэмжлэлийг дахин ашиглах.
-- Дүн/төлөв/түүхийг дахин тооцохгүй. CONFIRMED мөрийн confirmedAt-ийг updatedAt-аас нөхнө.

ALTER TABLE "ItgelSettlementPayment"
  ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "invoicePayload" JSONB,
  ADD COLUMN IF NOT EXISTS "senderInvoiceNo" TEXT,
  ADD COLUMN IF NOT EXISTS "invoiceAttemptAt" TIMESTAMP(3);

UPDATE "ItgelSettlementPayment"
SET "confirmedAt" = "updatedAt"
WHERE status = 'CONFIRMED' AND "confirmedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ItgelSettlementPayment_senderInvoiceNo_key"
  ON "ItgelSettlementPayment"("senderInvoiceNo");

CREATE INDEX IF NOT EXISTS "ItgelSettlementPayment_status_confirmedAt_idx"
  ON "ItgelSettlementPayment"("status", "confirmedAt");
