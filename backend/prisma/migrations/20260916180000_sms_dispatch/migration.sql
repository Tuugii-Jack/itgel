-- SMS илгээлтийн оролдлого / хүргэлтийн төлөв. Хүлээн авсан болон хүргэгдсэнийг тусгаарлана.

CREATE TABLE "SmsDispatch" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "checkCount" INTEGER NOT NULL DEFAULT 0,
    "nextCheckAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsDispatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmsDispatch_idempotencyKey_key" ON "SmsDispatch"("idempotencyKey");
CREATE INDEX "SmsDispatch_status_nextCheckAt_idx" ON "SmsDispatch"("status", "nextCheckAt");
CREATE INDEX "SmsDispatch_relatedType_relatedId_createdAt_idx" ON "SmsDispatch"("relatedType", "relatedId", "createdAt");
CREATE INDEX "SmsDispatch_phone_purpose_createdAt_idx" ON "SmsDispatch"("phone", "purpose", "createdAt");
CREATE INDEX "SmsDispatch_providerMessageId_idx" ON "SmsDispatch"("providerMessageId");
