-- AlterTable
ALTER TABLE "Setting" ADD COLUMN "leasingFeeTiers" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Setting" ADD COLUMN "leasingChoiceHint" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Setting" ADD COLUMN "leasingTermsTitle" TEXT NOT NULL DEFAULT 'Лизингийн нөхцөл';
ALTER TABLE "Setting" ADD COLUMN "leasingTermsBody" TEXT NOT NULL DEFAULT '';
