/**
 * Бүх хүснэгтийг JSON болгож хадгална — schema өөрчлөхийн өмнөх нөөц.
 *
 *   npx tsx scripts/backup-json.ts <хавтас>
 *
 * Зөвхөн уншина. Сэргээхдээ файлуудыг гараар харна — автомат сэргээлт байхгүй,
 * учир нь буруу сэргээлт нь нөөцгүй байснаас ч дор.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../src/prisma.js';

const dir = process.argv[2];
if (!dir) {
  console.error('Хэрэглээ: npx tsx scripts/backup-json.ts <хавтас>');
  process.exit(1);
}
const outDir: string = dir;

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });

  const tables = {
    setting: () => prisma.setting.findMany(),
    category: () => prisma.category.findMany(),
    product: () => prisma.product.findMany(),
    productVariant: () => prisma.productVariant.findMany(),
    sizeChartRow: () => prisma.sizeChartRow.findMany(),
    customer: () => prisma.customer.findMany(),
    order: () => prisma.order.findMany(),
    orderItem: () => prisma.orderItem.findMany(),
    payment: () => prisma.payment.findMany(),
    batch: () => prisma.batch.findMany(),
    delivery: () => prisma.delivery.findMany(),
    adminUser: () => prisma.adminUser.findMany(),
    ad: () => prisma.ad.findMany(),
    auditLog: () => prisma.auditLog.findMany(),
  };

  for (const [name, load] of Object.entries(tables)) {
    const rows = await load();
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(rows, null, 2));
    console.info(`${name}: ${rows.length}`);
  }

  console.info(`\nНөөц бэлэн: ${outDir}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
