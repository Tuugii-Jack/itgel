/** Production probe — prints no secrets. */
import '../src/env.js';
import { prisma } from '../src/prisma.js';

function hostOf(url: string | undefined) {
  if (!url) return { ok: false, host: '', db: '' };
  try {
    const u = new URL(url);
    return { ok: true, host: u.hostname, db: u.pathname.replace(/^\//, '').split('?')[0] };
  } catch {
    return { ok: false, host: 'unparseable', db: '' };
  }
}

async function main() {
  const db = hostOf(process.env.DATABASE_URL);
  const direct = hostOf(process.env.DIRECT_URL);
  console.log(JSON.stringify({
    databaseHost: db.host,
    databaseName: db.db,
    hostLooksSupabase: /supabase\.com$/i.test(db.host),
    directHost: direct.host,
    directSameProject: direct.host.split('.')[0] === db.host.split('.')[0] || direct.host.includes('supabase'),
    nodeEnv: process.env.NODE_ENV,
  }, null, 2));

  const settings = await prisma.setting.findUnique({
    where: { id: 1 },
    select: {
      storeName: true,
      unpaidCancelHours: true,
      leasingFeeTiers: true,
      leasingPayGaps: true,
      leasingSettlementAdminId: true,
    },
  });
  const owner = settings?.leasingSettlementAdminId
    ? await prisma.adminUser.findUnique({
        where: { id: settings.leasingSettlementAdminId },
        select: { id: true, name: true, role: true, isActive: true },
      })
    : null;

  const admins = await prisma.adminUser.findMany({
    where: { isActive: true },
    select: { id: true, name: true, role: true },
    orderBy: { role: 'asc' },
  });

  const demoExisting = await prisma.order.findMany({
    where: { note: { contains: '[DEMO]' } },
    select: { id: true, code: true, note: true, status: true },
    take: 20,
  });
  const demoCustomers = await prisma.customer.findMany({
    where: { OR: [{ name: { contains: '[DEMO]' } }, { name: { contains: '[TEST]' } }] },
    select: { id: true, name: true, phone: true, notifyPayment: true, notifyArrival: true },
  });

  const orderRounds = await prisma.productRound.findMany({
    where: { deletedAt: null, closeAt: { not: null }, status: 'ACTIVE', product: { ownerKind: 'SHOP', deletedAt: null } },
    select: {
      id: true, sellPrice: true, stock: true, closeAt: true, cargoFee: true,
      product: { select: { name: true } },
    },
    orderBy: { sellPrice: 'asc' },
    take: 8,
  });
  const readyRounds = await prisma.productRound.findMany({
    where: { deletedAt: null, closeAt: null, status: 'ACTIVE', available: { gte: 1 }, product: { ownerKind: 'SHOP', deletedAt: null } },
    select: {
      id: true, sellPrice: true, stock: true, reserved: true, available: true,
      product: { select: { name: true } },
      skuStocks: { select: { skuKey: true, stock: true, reserved: true, available: true, selections: true } },
    },
    orderBy: { available: 'desc' },
    take: 8,
  });
  const leasingReady = await prisma.productRound.findMany({
    where: { deletedAt: null, closeAt: null, status: 'ACTIVE', available: { gte: 1 }, ownerKind: 'LEASING' },
    select: {
      id: true, sellPrice: true, available: true, ownerAdminId: true,
      product: { select: { name: true } },
    },
    take: 8,
  });
  const productCount = await prisma.product.count({ where: { deletedAt: null } });
  const roundCount = await prisma.productRound.count({ where: { deletedAt: null } });

  console.log(JSON.stringify({
    storeName: settings?.storeName,
    unpaidCancelHours: settings?.unpaidCancelHours,
    leasingFeeTiers: settings?.leasingFeeTiers,
    leasingPayGaps: settings?.leasingPayGaps,
    settlementAdmin: owner,
    admins: admins.map((a) => ({ role: a.role, name: a.name, idPrefix: a.id.slice(0, 8) })),
    productCount,
    roundCount,
    demoOrders: demoExisting.length,
    demoCustomers: demoCustomers.map((c) => ({ name: c.name, hasPhone: Boolean(c.phone), notifyPayment: c.notifyPayment })),
    sampleOrderRounds: orderRounds.map((r) => ({
      name: r.product.name, price: r.sellPrice, stock: r.stock, cargo: r.cargoFee, closeAt: r.closeAt,
    })),
    sampleReady: readyRounds.map((r) => ({
      name: r.product.name, price: r.sellPrice, available: r.available,
      skus: r.skuStocks.filter((s) => (s.available ?? s.stock - s.reserved) > 0).slice(0, 3),
    })),
    sampleLeasingReady: leasingReady.map((r) => ({ name: r.product.name, price: r.sellPrice, available: r.available })),
  }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
