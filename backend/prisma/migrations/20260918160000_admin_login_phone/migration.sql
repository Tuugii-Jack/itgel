-- Админы OTP нэвтрэлтийн утас + session epoch.
-- Дугаар тааж оноохгүй. Хуучин JWT-г tv-ээр хүчингүй болгоно.

ALTER TABLE "AdminUser"
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "phoneVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS "AdminUser_phone_key" ON "AdminUser"("phone");

ALTER TABLE "PhoneOtp"
  ADD COLUMN IF NOT EXISTS "ip" TEXT,
  ADD COLUMN IF NOT EXISTS "adminUserId" TEXT;

CREATE INDEX IF NOT EXISTS "PhoneOtp_ip_createdAt_idx" ON "PhoneOtp"("ip", "createdAt");
CREATE INDEX IF NOT EXISTS "PhoneOtp_adminUserId_purpose_createdAt_idx"
  ON "PhoneOtp"("adminUserId", "purpose", "createdAt");

UPDATE "AdminUser" SET "tokenVersion" = "tokenVersion" + 1;
