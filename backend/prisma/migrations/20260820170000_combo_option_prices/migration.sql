-- Сонголтын үнийг нэг бүлгээс (хэмжээ) хослол бүрт (материал × хэмжээ × …) шилжүүлнэ.
ALTER TABLE "RoundOptionPrice" ADD COLUMN "skuKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "RoundOptionPrice" ADD COLUMN "selections" JSONB NOT NULL DEFAULT '{}';

UPDATE "RoundOptionPrice"
SET
  "skuKey" = "kind" || '=' || "value",
  "selections" = jsonb_build_object("kind", "value");

ALTER TABLE "RoundOptionPrice" ALTER COLUMN "skuKey" DROP DEFAULT;

DROP INDEX IF EXISTS "RoundOptionPrice_roundId_kind_value_key";
CREATE UNIQUE INDEX "RoundOptionPrice_roundId_skuKey_key" ON "RoundOptionPrice"("roundId", "skuKey");
