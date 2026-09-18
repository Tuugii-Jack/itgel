-- OWNER эрх + админ бүртгэлд олон нэвтрэх дугаар.
-- Хувийн дугаарыг энд бичихгүй.

ALTER TYPE "AdminRole" ADD VALUE IF NOT EXISTS 'OWNER';

CREATE TABLE "AdminLoginPhone" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminLoginPhone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminLoginPhone_phone_key" ON "AdminLoginPhone"("phone");

CREATE INDEX "AdminLoginPhone_adminUserId_idx" ON "AdminLoginPhone"("adminUserId");

ALTER TABLE "AdminLoginPhone"
  ADD CONSTRAINT "AdminLoginPhone_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "AdminLoginPhone" ("id", "adminUserId", "phone", "verifiedAt", "createdAt")
SELECT
  concat('clp', replace(gen_random_uuid()::text, '-', '')),
  a."id",
  a."phone",
  a."phoneVerifiedAt",
  CURRENT_TIMESTAMP
FROM "AdminUser" a
WHERE a."phone" IS NOT NULL
  AND a."phoneVerifiedAt" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "AdminLoginPhone" p WHERE p."phone" = a."phone"
  );
