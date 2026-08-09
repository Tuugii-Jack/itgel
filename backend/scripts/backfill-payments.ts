/**
 * Нэг удаагийн шилжилт: төлбөрийн дэвтэр нэвтрүүлэхээс өмнөх захиалгуудад
 * `paidAmount` нь Order дээр шууд бичигдсэн байсан. Дэвтэрт харгалзах мөр
 * үүсгэж, кэшийг дахин бодуулна.
 *
 * Дахин ажиллуулахад аюулгүй: дэвтэрт бичилттэй захиалгыг алгасна.
 *
 *   npx tsx scripts/backfill-payments.ts --dry     # зөвхөн харах
 *   npx tsx scripts/backfill-payments.ts           # гүйцэтгэх
 */
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import { recalcOrderTotals } from '../src/services/money.js';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry');

async function main() {
  const orders = await prisma.order.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      status: true,
      subtotal: true,
      deliveryFee: true,
      paidAmount: true,
      createdAt: true,
      handedOverAt: true,
      _count: { select: { payments: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const needsLedger = orders.filter((o) => o._count.payments === 0 && o.paidAmount > 0);

  console.info(`Нийт захиалга          : ${orders.length}`);
  console.info(`Дэвтрийн бичилт хэрэгтэй: ${needsLedger.length}`);

  if (dryRun) {
    for (const o of needsLedger.slice(0, 10)) {
      console.info(`  ${o.code}  ${o.paidAmount}₮  (${o.status})`);
    }
    if (needsLedger.length > 10) console.info(`  … бас ${needsLedger.length - 10}`);
    console.info('\n--dry горим — юу ч бичсэнгүй.');
    return;
  }

  let ledgerCreated = 0;
  for (const order of needsLedger) {
    await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          orderId: order.id,
          kind: 'PAYMENT',
          amount: order.paidAmount,
          method: 'BANK_TRANSFER',
          note: 'Дэвтэр нэвтрүүлэхээс өмнөх бичилт',
          actor: 'system',
          // Төлбөр нь захиалгын дараа орсон гэж үзнэ.
          createdAt: order.createdAt,
        },
      });
      await recalcOrderTotals(tx, order.id);
    });
    ledgerCreated += 1;
  }

  // Үлдсэн бүх захиалгын кэшийг дахин бодуулж, дэвтэртэй нийцүүлнэ.
  let recalculated = 0;
  for (const order of orders) {
    await prisma.$transaction(async (tx) => {
      await recalcOrderTotals(tx, order.id);
    });
    recalculated += 1;
  }

  console.info(`\nДэвтэрт нэмсэн   : ${ledgerCreated}`);
  console.info(`Дахин бодсон      : ${recalculated}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
