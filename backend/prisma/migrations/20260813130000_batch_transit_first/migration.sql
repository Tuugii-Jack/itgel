-- Багц: Зам дээрээс эхлэх урсгал.
-- Хуучин COLLECTING / CLOSED / AT_SUPPLIER → IN_TRANSIT.
UPDATE "Batch"
SET "stage" = 'IN_TRANSIT'
WHERE "stage" IN ('COLLECTING', 'CLOSED', 'AT_SUPPLIER');

-- Анхдагч шат (шинэ багц)
ALTER TABLE "Batch" ALTER COLUMN "stage" SET DEFAULT 'IN_TRANSIT';
