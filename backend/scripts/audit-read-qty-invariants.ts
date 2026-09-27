/**
 * Зөвхөн унших: хуучин өгөгдлийн ширхэг/мөнгөний зөрүүг харуулна.
 * Production дээр UPDATE хийхгүй. Isolated DB дээр ажиллуулна.
 *
 *   cd backend && npx tsx scripts/audit-read-qty-invariants.ts
 */
import { prisma } from '../src/prisma.js';

async function main() {
  const handedGtArrived = await prisma.$queryRaw<{ id: string; code: string; qty: number; arrivedQty: number; handedOverQty: number }[]>`
    SELECT i.id, o.code, i.qty, i."arrivedQty", i."handedOverQty"
    FROM "OrderItem" i
    JOIN "Order" o ON o.id = i."orderId"
    WHERE i."cancelledAt" IS NULL
      AND o."deletedAt" IS NULL
      AND i."handedOverQty" > i."arrivedQty"
    LIMIT 50
  `;
  const arrivedGtQty = await prisma.$queryRaw<{ id: string; code: string; qty: number; arrivedQty: number }[]>`
    SELECT i.id, o.code, i.qty, i."arrivedQty"
    FROM "OrderItem" i
    JOIN "Order" o ON o.id = i."orderId"
    WHERE i."cancelledAt" IS NULL
      AND o."deletedAt" IS NULL
      AND i."arrivedQty" > i.qty
    LIMIT 50
  `;
  const leasingShopMix = await prisma.$queryRaw<{ id: string; code: string; paidAmount: number; shopPaidAmount: number; cargoFee: number }[]>`
    SELECT id, code, "paidAmount", "shopPaidAmount", "cargoFee"
    FROM "Order"
    WHERE "isLeasing" = true
      AND "deletedAt" IS NULL
      AND "cargoFee" > 0
      AND "shopPaidAmount" = 0
      AND "paidAmount" > "leasingFee"
    LIMIT 50
  `;
  const noPieceAudit = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "OrderItem" i
    WHERE i."handedOverQty" > 0
      AND i."cancelledAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "AuditLog" a
        WHERE a."entityId" = i."orderId"
          AND a.action IN ('HANDOVER', 'HANDOVER_PARTIAL')
          AND a.after ? 'lines'
      )
  `;

  const batchArrivalWaves = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "AuditLog"
    WHERE action = 'BATCH_ARRIVAL'
  `;

  console.log(JSON.stringify({
    handedGtArrived,
    arrivedGtQty,
    leasingShopMix,
    itemsHandedWithoutPieceAudit: Number(noPieceAudit[0]?.count ?? 0),
    batchArrivalWaves: Number(batchArrivalWaves[0]?.count ?? 0),
    note: 'BATCH_ARRIVAL after.allocations has orderCode+add, not itemId/day. Mixed remaining storage cannot be reconstructed without inventing FIFO.',
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
