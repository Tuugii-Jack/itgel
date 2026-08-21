-- Сонголт (хэмжээ/өнгө/…) бүрийн нэгж карго үнэ.
CREATE TABLE IF NOT EXISTS "RoundCargoFee" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "skuKey" TEXT NOT NULL,
    "selections" JSONB NOT NULL,
    "cargoFee" INTEGER NOT NULL,

    CONSTRAINT "RoundCargoFee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RoundCargoFee_roundId_skuKey_key" ON "RoundCargoFee"("roundId", "skuKey");

CREATE INDEX IF NOT EXISTS "RoundCargoFee_roundId_idx" ON "RoundCargoFee"("roundId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RoundCargoFee_roundId_fkey'
  ) THEN
    ALTER TABLE "RoundCargoFee"
      ADD CONSTRAINT "RoundCargoFee_roundId_fkey"
      FOREIGN KEY ("roundId") REFERENCES "ProductRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
