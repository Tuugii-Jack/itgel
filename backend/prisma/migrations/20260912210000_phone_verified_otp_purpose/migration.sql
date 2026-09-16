-- Нэвтрэх утасны баталгаажуулалт + PhoneOtp зорилго (LOGIN / CHANGE_PHONE).
-- Хуучин OTP бүртгэл (нууц үггүй, утастай) баталгаажсан гэж тэмдэглэнэ.
-- И-мэйл+нууц үгээр бүртгүүлсэн утас баталгаажаагүй хэвээр.

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "phoneVerifiedAt" TIMESTAMP(3);

UPDATE "Customer"
SET "phoneVerifiedAt" = "createdAt"
WHERE "phone" IS NOT NULL
  AND "passwordHash" IS NULL
  AND "phoneVerifiedAt" IS NULL;

ALTER TABLE "PhoneOtp" ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'LOGIN';
ALTER TABLE "PhoneOtp" ADD COLUMN IF NOT EXISTS "customerId" TEXT;
ALTER TABLE "PhoneOtp" ADD COLUMN IF NOT EXISTS "previousPhone" TEXT;

CREATE INDEX IF NOT EXISTS "PhoneOtp_phone_purpose_createdAt_idx"
  ON "PhoneOtp"("phone", "purpose", "createdAt");

CREATE INDEX IF NOT EXISTS "PhoneOtp_customerId_purpose_createdAt_idx"
  ON "PhoneOtp"("customerId", "purpose", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PhoneOtp_customerId_fkey'
  ) THEN
    ALTER TABLE "PhoneOtp"
      ADD CONSTRAINT "PhoneOtp_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
