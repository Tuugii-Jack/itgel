-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "addressText" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "khoroo" TEXT,
ADD COLUMN     "notifyArrival" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyPayment" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyPromo" BOOLEAN NOT NULL DEFAULT false;
