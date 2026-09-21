-- Төлсөн өдрийг updatedAt-аас таамаглахгүй. Audit нотолгоо байвал нөхнө, үгүй бол NULL.
-- Дүн, өрийн төлөв, төлбөрийн түүхийн дүнг өөрчлөхгүй.

ALTER TABLE "ItgelSettlementPayment"
  ADD COLUMN IF NOT EXISTS "confirmedAtSource" TEXT;

ALTER TABLE "MoneyException"
  ADD COLUMN IF NOT EXISTS "reference" TEXT;

UPDATE "ItgelSettlementPayment" AS p
SET
  "confirmedAt" = a."createdAt",
  "confirmedAtSource" = 'AUDIT'
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "createdAt"
  FROM "AuditLog"
  WHERE entity = 'ItgelSettlementPayment'
    AND action = 'ITGEL_PAYMENT_CONFIRMED'
  ORDER BY "entityId", "createdAt" ASC
) AS a
WHERE p.id = a."entityId"
  AND p.status = 'CONFIRMED'
  AND (p."confirmedAtSource" IS NULL OR p."confirmedAtSource" = 'AUDIT');

UPDATE "ItgelSettlementPayment"
SET "confirmedAt" = NULL, "confirmedAtSource" = NULL
WHERE status = 'CONFIRMED'
  AND COALESCE("confirmedAtSource", '') NOT IN ('EVENT', 'AUDIT');

DELETE FROM "MoneyException" AS dup
USING "MoneyException" AS keep
WHERE dup.status = 'OPEN'
  AND keep.status = 'OPEN'
  AND dup.kind = keep.kind
  AND COALESCE(dup."qpayInvoiceId", '') = COALESCE(keep."qpayInvoiceId", '')
  AND COALESCE(dup."reference", '') = COALESCE(keep."reference", '')
  AND COALESCE(dup."settlementPaymentId", '') = COALESCE(keep."settlementPaymentId", '')
  AND COALESCE(dup."orderId", '') = COALESCE(keep."orderId", '')
  AND dup."createdAt" > keep."createdAt";

CREATE INDEX IF NOT EXISTS "MoneyException_qpayInvoiceId_status_idx"
  ON "MoneyException"("qpayInvoiceId", status);

CREATE UNIQUE INDEX IF NOT EXISTS "MoneyException_open_invoice_ref_idx"
  ON "MoneyException" (
    kind,
    COALESCE("qpayInvoiceId", ''),
    COALESCE("reference", ''),
    COALESCE("settlementPaymentId", ''),
    COALESCE("orderId", '')
  )
  WHERE status = 'OPEN';
