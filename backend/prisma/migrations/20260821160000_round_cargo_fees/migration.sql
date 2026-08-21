-- Сонголт (хэмжээ/өнгө/…) бүрийн нэгж карго үнэ.
CREATE TABLE "RoundCargoFee" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "skuKey" TEXT NOT NULL,
    "selections" JSONB NOT NULL,
    "cargoFee" INTEGER NOT NULL,

    CONSTRAINT "RoundCargoFee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoundCargoFee_roundId_skuKey_key" ON "RoundCargoFee"("roundId", "skuKey");

CREATE INDEX "RoundCargoFee_roundId_idx" ON "RoundCargoFee"("roundId");

ALTER TABLE "RoundCargoFee" ADD CONSTRAINT "RoundCargoFee_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "ProductRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
