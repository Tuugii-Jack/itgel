-- AlterTable
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);

-- Backfill email for legacy phone-only customers
UPDATE "Customer"
SET "email" = 'legacy+' || "phone" || '@phone.local'
WHERE "email" IS NULL AND "phone" IS NOT NULL;

UPDATE "Customer"
SET "email" = 'legacy+' || "id" || '@unknown.local'
WHERE "email" IS NULL;

-- Make email required + unique
ALTER TABLE "Customer" ALTER COLUMN "email" SET NOT NULL;

DROP INDEX IF EXISTS "Customer_email_key";
CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");

-- Phone becomes optional (contact only)
ALTER TABLE "Customer" ALTER COLUMN "phone" DROP NOT NULL;

-- Email OTP table
CREATE TABLE IF NOT EXISTS "EmailOtp" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "EmailOtp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EmailOtp_email_purpose_createdAt_idx" ON "EmailOtp"("email", "purpose", "createdAt");

-- Drop legacy phone OTP table if present
DROP TABLE IF EXISTS "OtpCode";
