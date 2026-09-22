import '../src/env.js';
import { prisma } from '../src/prisma.js';

async function main() {
  const priced = await prisma.productRound.findMany({
    where: { deletedAt: null, sellPrice: { gte: 10000 } },
    select: {
      id: true,
      status: true,
      closeAt: true,
      sellPrice: true,
      costPrice: true,
      cargoFee: true,
      stock: true,
      available: true,
      ownerKind: true,
      ownerAdminId: true,
      productId: true,
      roundNo: true,
      product: { select: { name: true, ownerKind: true } },
      skuStocks: { select: { skuKey: true, stock: true, available: true, selections: true }, take: 6 },
    },
    orderBy: { sellPrice: 'desc' },
    take: 30,
  });
  const hiddenReady = await prisma.productRound.findMany({
    where: { deletedAt: null, closeAt: null },
    select: {
      status: true, sellPrice: true, available: true, stock: true, ownerKind: true,
      product: { select: { name: true, ownerKind: true } },
    },
  });
  const batches = await prisma.batch.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, stage: true },
    take: 10,
    orderBy: { createdAt: 'desc' },
  });
  console.log(JSON.stringify({
    pricedCount: priced.length,
    priced: priced.map((r) => ({
      name: r.product.name,
      price: r.sellPrice,
      cost: r.costPrice,
      cargo: r.cargoFee,
      status: r.status,
      type: r.closeAt ? 'order' : 'ready',
      owner: r.ownerKind,
      roundNo: r.roundNo,
      sku: r.skuStocks.length,
    })),
    hiddenReady,
    batches,
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
