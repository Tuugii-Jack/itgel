-- Гаргалт дээр сонголт (хэмжээ гэх мэт) тус бүрийн үнэ.
CREATE TABLE "RoundOptionPrice" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sellPrice" INTEGER NOT NULL,
    "costPrice" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RoundOptionPrice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoundOptionPrice_roundId_kind_value_key" ON "RoundOptionPrice"("roundId", "kind", "value");
CREATE INDEX "RoundOptionPrice_roundId_idx" ON "RoundOptionPrice"("roundId");

ALTER TABLE "RoundOptionPrice" ADD CONSTRAINT "RoundOptionPrice_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "ProductRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
