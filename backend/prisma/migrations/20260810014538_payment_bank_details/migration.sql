-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paymentClaimedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "bankAccountName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bankAccountNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bankName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "paymentNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "unpaidCancelHours" INTEGER NOT NULL DEFAULT 0;
