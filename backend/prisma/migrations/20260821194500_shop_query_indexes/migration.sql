-- Shop list / order filters: skip deleted rows without scanning the whole table.
CREATE INDEX IF NOT EXISTS "Product_deletedAt_idx" ON "Product"("deletedAt");
CREATE INDEX IF NOT EXISTS "ProductRound_deletedAt_status_closeAt_idx" ON "ProductRound"("deletedAt", "status", "closeAt");
CREATE INDEX IF NOT EXISTS "Order_deletedAt_status_createdAt_idx" ON "Order"("deletedAt", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "OrderItem_roundId_cancelledAt_idx" ON "OrderItem"("roundId", "cancelledAt");
