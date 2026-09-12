ALTER TABLE "EmailOtp" ADD COLUMN "customerId" TEXT,
    ADD COLUMN "previousEmail" TEXT;
CREATE INDEX "EmailOtp_customerId_purpose_createdAt_idx" ON "EmailOtp"("customerId", "purpose", "createdAt");
ALTER TABLE "EmailOtp" ADD CONSTRAINT "EmailOtp_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "QpayInvoice" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QpayInvoice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "QpayInvoice_orderId_idx" ON "QpayInvoice"("orderId");
ALTER TABLE "QpayInvoice" ADD CONSTRAINT "QpayInvoice_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve the currently stored invoices before any can be replaced by the new code.
INSERT INTO "QpayInvoice" ("id", "orderId", "account", "createdAt")
SELECT "qpayInvoiceId", "id", CASE WHEN "isLeasing" THEN 'leasing' ELSE 'shop' END,
       COALESCE("qpayInvoiceAt", "createdAt")
FROM "Order" WHERE "qpayInvoiceId" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "Payment" ADD COLUMN "qpayInvoiceId" TEXT;
CREATE INDEX "Payment_qpayInvoiceId_kind_idx" ON "Payment"("qpayInvoiceId", "kind");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_qpayInvoiceId_fkey"
    FOREIGN KEY ("qpayInvoiceId") REFERENCES "QpayInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Legacy invoice references can be associated without guessing or changing amounts.
UPDATE "Payment" p SET "qpayInvoiceId" = i."id"
FROM "QpayInvoice" i
WHERE p."orderId" = i."orderId" AND p."method" = 'QPAY'
  AND p."reference" = 'qpay:' || i."id";
