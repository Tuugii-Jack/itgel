-- Хэсэгчилсэн олголтын ширхэг. Хуучин бүрэн олголтыг handedOverAt-аар хадгална; таамгаар нөхөхгүй.
-- handedOverAt нь бүтэн мөрийн олголт. arrivedAt тавигдсан мөрийг өмнөх migration бүтнээр ирсэн гэж үзсэн.
-- Зөрүүтэй мөр дээр qty/arrivedQty-г өсгөхгүй, түүх дарж засахгүй — handedOverQty=0 үлдэнэ.
-- Runtime handedQtyOf(handedOverAt) хуучин бүрэн олголтыг хэвээр уншина.

ALTER TABLE "OrderItem" ADD COLUMN "handedOverQty" INTEGER NOT NULL DEFAULT 0;

UPDATE "OrderItem"
SET "handedOverQty" = "qty"
WHERE "handedOverAt" IS NOT NULL
  AND "handedOverQty" = 0
  AND "arrivedQty" >= "qty";

CREATE INDEX "OrderItem_handedOverQty_idx" ON "OrderItem"("handedOverQty");

CREATE TABLE "ActorIdempotency" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActorIdempotency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActorIdempotency_kind_actorId_idempotencyKey_key"
    ON "ActorIdempotency"("kind", "actorId", "idempotencyKey");

CREATE INDEX "ActorIdempotency_createdAt_idx" ON "ActorIdempotency"("createdAt");
