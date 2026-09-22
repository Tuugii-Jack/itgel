import '../src/env.js';
import { prisma } from '../src/prisma.js';

async function main() {
  const byStatus = await prisma.productRound.groupBy({
    by: ['status'],
    where: { deletedAt: null },
    _count: { _all: true },
  });
  const ready = await prisma.productRound.count({ where: { deletedAt: null, closeAt: null } });
  const preorder = await prisma.productRound.count({ where: { deletedAt: null, closeAt: { not: null } } });
  const shop = await prisma.product.count({ where: { deletedAt: null, ownerKind: 'SHOP' } });
  const leasing = await prisma.product.count({ where: { deletedAt: null, ownerKind: 'LEASING' } });
  const samples = await prisma.productRound.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      status: true,
      closeAt: true,
      stock: true,
      reserved: true,
      available: true,
      sellPrice: true,
      costPrice: true,
      cargoFee: true,
      ownerKind: true,
      ownerAdminId: true,
      productId: true,
      product: { select: { name: true, ownerKind: true, categoryId: true } },
      skuStocks: { select: { skuKey: true, stock: true, available: true, selections: true }, take: 4 },
    },
    orderBy: { sellPrice: 'asc' },
    take: 25,
  });
  const leasingAdmin = await prisma.adminUser.findFirst({
    where: { role: 'LEASING', isActive: true },
    select: { id: true, name: true },
  });
  const owner = await prisma.adminUser.findFirst({
    where: { role: 'OWNER', isActive: true },
    select: { id: true, name: true },
  });
  console.log(JSON.stringify({
    byStatus,
    ready,
    preorder,
    shopProducts: shop,
    leasingProducts: leasing,
    leasingAdminName: leasingAdmin?.name,
    ownerName: owner?.name,
    samples: samples.map((r) => ({
      name: r.product.name,
      status: r.status,
      type: r.closeAt ? 'order' : 'ready',
      stock: r.stock,
      available: r.available,
      price: r.sellPrice,
      owner: r.ownerKind,
      sku: r.skuStocks.length,
    })),
  }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
