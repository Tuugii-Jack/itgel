/**
 * Demo: хоцорсон агуулахын хураамж харагдах захиалга бэлдэнэ.
 * Usage: npx tsx scripts/demo-storage-fee.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { addDays } from '../src/lib/date.js';
import { syncOrderStorageFee } from '../src/services/storageFee.js';

const prisma = new PrismaClient();
const now = new Date();

async function main() {
  const overdue = await prisma.order.findFirst({
    where: { code: 'PH-TL8B2V', deletedAt: null },
    include: { customer: true },
  });
  if (!overdue) throw new Error('PH-TL8B2V олдсонгүй');

  const arrivedAt = addDays(now, -12);
  await prisma.order.update({
    where: { id: overdue.id },
    data: { arrivedAt, status: 'ARRIVED' },
  });
  await prisma.orderItem.updateMany({
    where: { orderId: overdue.id, cancelledAt: null },
    data: { arrivedAt, handedOverAt: null },
  });
  const storage = await syncOrderStorageFee(overdue.id, now);
  const fresh = await prisma.order.findUniqueOrThrow({ where: { id: overdue.id } });

  const soon = await prisma.order.findFirst({ where: { code: 'PH-S5R8R8', deletedAt: null } });
  if (soon) {
    const a2 = addDays(now, -3);
    await prisma.order.update({
      where: { id: soon.id },
      data: { arrivedAt: a2, status: 'ARRIVED' },
    });
    await prisma.orderItem.updateMany({
      where: { orderId: soon.id, cancelledAt: null },
      data: { arrivedAt: a2, handedOverAt: null },
    });
    await syncOrderStorageFee(soon.id, now);
  }

  console.log('--- Хоцорсон (хураамжтай) ---');
  console.log(`Код:        ${overdue.code}`);
  console.log(`Хэрэглэгч:  ${overdue.customer.name} · ${overdue.customer.phone}`);
  console.log(`Ирсэн:      12 хоногийн өмнө`);
  console.log(`Хураамж:    ${fresh.storageFee}₮ (${storage.billableItemDays} мөр-хоног)`);
  console.log(`Үлдэгдэл:   ${fresh.dueAmount}₮`);
  console.log(`SHOP:       /t/${overdue.code}`);
  console.log(`ADMIN:      /admin → ${overdue.code} нээх`);
  console.log(`HANDOVER:   /admin/handover → утас ${overdue.customer.phone}`);
  if (soon) {
    console.log('--- Үнэгүй хоног үлдсэн ---');
    console.log(`Код:        ${soon.code}`);
    console.log(`SHOP:       /t/${soon.code}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
