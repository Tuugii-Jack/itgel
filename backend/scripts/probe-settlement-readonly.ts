/** Production read-only probe. No writes. */
import '../src/env.js';
import { prisma } from '../src/prisma.js';

function hostOf(url: string | undefined) {
  if (!url) return { host: '', db: '' };
  try {
    const u = new URL(url);
    return { host: u.hostname, db: u.pathname.replace(/^\//, '').split('?')[0] };
  } catch {
    return { host: 'unparseable', db: '' };
  }
}

async function main() {
  const db = hostOf(process.env.DATABASE_URL);
  console.log(JSON.stringify({ databaseHost: db.host, databaseName: db.db, readOnly: true }, null, 2));

  const [statusCounts, mismatches, lockedNoInvoice, payments, orderLedger, stock, allocation] = await Promise.all([
    prisma.$queryRaw<
      { status: string; n: bigint; remaining: bigint }[]
    >`SELECT status, count(*)::bigint AS n, COALESCE(sum("remainingAmount"),0)::bigint AS remaining
       FROM "ItgelSettlement" GROUP BY status`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n
      FROM "ItgelSettlement" s
      LEFT JOIN "Order" o ON o.id = s."sourceOrderId"
      LEFT JOIN "OrderItem" i ON i.id = s."sourceOrderItemId"
      WHERE s.status <> 'VOID'
        AND (
          o.id IS NULL
          OR i.id IS NULL
          OR o.code IS DISTINCT FROM s."sourceOrderCode"
          OR i.qty IS DISTINCT FROM s.qty
          OR i."unitPrice" IS DISTINCT FROM s."unitPrice"
          OR s.amount <> s.qty * s."unitPrice"
          OR s."paidAmount" + s."remainingAmount" <> s.amount
        )`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n
      FROM "ItgelSettlement" s
      LEFT JOIN "ItgelSettlementPayment" p ON p.id = s."lockPaymentId"
      WHERE s.status = 'INVOICED'
        AND (s."lockPaymentId" IS NULL OR p."qpayInvoiceId" IS NULL)`,
    prisma.$queryRaw<{ status: string; n: bigint }[]>`
      SELECT status, count(*)::bigint AS n FROM "ItgelSettlementPayment" GROUP BY status`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM "Order" o
      LEFT JOIN (
        SELECT "orderId", sum(amount) FILTER (WHERE kind='PAYMENT') AS paid,
          sum(amount) FILTER (WHERE kind='REFUND') AS refunded,
          sum(amount) FILTER (WHERE kind='PAYMENT' AND "payeeKind"='SHOP') AS shop_paid,
          sum(amount) FILTER (WHERE kind='REFUND' AND "payeeKind"='SHOP') AS shop_refunded
        FROM "Payment" GROUP BY "orderId"
      ) p ON p."orderId"=o.id
      LEFT JOIN (
        SELECT "orderId", sum(qty::bigint * "unitPrice") AS subtotal FROM "OrderItem"
        WHERE "cancelledAt" IS NULL GROUP BY "orderId"
      ) i ON i."orderId"=o.id
      WHERE o."deletedAt" IS NULL AND (
        o."paidAmount" <> COALESCE(p.paid,0) OR o."refundedAmount" <> COALESCE(p.refunded,0)
        OR o."shopPaidAmount" <> GREATEST(0,COALESCE(p.shop_paid,0)-COALESCE(p.shop_refunded,0))
        OR o.subtotal <> COALESCE(i.subtotal,0)
        OR o."dueAmount" <> o.subtotal::bigint + o."leasingFee" + o."storageFee" + o."cargoFee"
          - o."paidAmount" + o."refundedAmount" - o."writtenOffAmount"
      )`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM "ProductRound"
      WHERE "deletedAt" IS NULL AND "closeAt" IS NULL
        AND (stock < 0 OR reserved < 0 OR available < 0 OR reserved > stock OR available <> stock-reserved)`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM "ItgelSettlementPayment" p
      LEFT JOIN (SELECT "paymentId", sum(amount)::bigint AS amount FROM "ItgelSettlementPaymentLine" GROUP BY "paymentId") l ON l."paymentId"=p.id
      WHERE p.amount <> COALESCE(l.amount,0)`,
  ]);

  console.log(JSON.stringify({
    settlementsByStatus: statusCounts.map((row) => ({
      status: row.status,
      n: Number(row.n),
      remaining: Number(row.remaining),
    })),
    snapshotOrJoinMismatches: Number(mismatches[0]?.n ?? 0),
    invoicedWithoutQpay: Number(lockedNoInvoice[0]?.n ?? 0),
    paymentsByStatus: payments.map((row) => ({ status: row.status, n: Number(row.n) })),
    orderLedgerMismatches: Number(orderLedger[0]?.n ?? 0),
    readyStockMismatches: Number(stock[0]?.n ?? 0),
    settlementAllocationMismatches: Number(allocation[0]?.n ?? 0),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
