-- Checkout давхар даралт / retry — хэрэглэгч + key уникал.

CREATE TABLE "CheckoutIdempotency" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "response" JSONB,
    "orderIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutIdempotency_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CheckoutIdempotency_createdAt_idx" ON "CheckoutIdempotency"("createdAt");

CREATE UNIQUE INDEX "CheckoutIdempotency_customerId_idempotencyKey_key"
    ON "CheckoutIdempotency"("customerId", "idempotencyKey");

ALTER TABLE "CheckoutIdempotency"
    ADD CONSTRAINT "CheckoutIdempotency_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
