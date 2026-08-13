-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'QPAY';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "qpayInvoiceId" TEXT,
ADD COLUMN "qpayInvoiceAt" TIMESTAMP(3);
