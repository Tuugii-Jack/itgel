-- CreateTable
CREATE TABLE "RefundPayout" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "payoutDay" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,

    CONSTRAINT "RefundPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RefundPayout_payoutDay_idx" ON "RefundPayout"("payoutDay");

-- CreateIndex
CREATE UNIQUE INDEX "RefundPayout_customerId_payoutDay_key" ON "RefundPayout"("customerId", "payoutDay");

-- AddForeignKey
ALTER TABLE "RefundPayout" ADD CONSTRAINT "RefundPayout_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
