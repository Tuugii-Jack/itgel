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

  const [statusCounts, mismatches, lockedNoInvoice, payments] = await Promise.all([
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
