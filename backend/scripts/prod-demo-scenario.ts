/**
 * Production [DEMO] жишиг санхүүгийн өгөгдөл.
 * Жинхэнэ QPay/банк/SMS үүсгэхгүй. Бодит захиалгыг өөрчлөхгүй.
 *
 *   npx tsx scripts/prod-demo-scenario.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProductRound, ProductVariant } from '@prisma/client';
import '../src/env.js';
import { env } from '../src/env.js';
import { prisma } from '../src/prisma.js';
import { addDays, endOfUbDay, startOfUbDay, ubDateString } from '../src/lib/date.js';
import { unwrapAppError } from '../src/lib/errors.js';
import { buildLeasingPayPlan, leasingView } from '../src/lib/leasing.js';
import { checkoutFlagsForGroup } from '../src/lib/inventoryOwner.js';
import { optionsFromVariants, selectionsOf } from '../src/lib/options.js';
import { resolveOptionPrice } from '../src/lib/optionPrices.js';
import { skuKeyOf } from '../src/lib/skuStock.js';
import { createOrder } from '../src/services/createOrder.js';
import { createOrderWithUniqueCode } from '../src/modules/orders/createWithCode.js';
import { snapshotOrderLines } from '../src/modules/orders/lineSnapshots.js';
import { recordPayment } from '../src/services/payments.js';
import { changeOrderStatus, handOverItems } from '../src/services/orders.js';
import { attachOrdersForRound, promoteOrdersForBatchStage } from '../src/services/batches.js';
import { registerBatchArrivals } from '../src/services/batchArrival.js';
import {
  confirmBankSettlementPayment,
  createSettlementPayment,
  daySummary,
  rejectBankSettlementPayment,
} from '../src/services/itgelSettlement.js';
import { executeReadyTransfer } from '../src/services/readyTransfer.js';
import { reserveReadyStock } from '../src/services/readyStock.js';
import { syncOrderCargoFee } from '../src/services/cargoFee.js';
import { getSettings, leasingPayGapsOf } from '../src/services/settings.js';

const SCENARIO = 'DEMO-20260921-A';
const ACTOR = `demo:${SCENARIO}`;
const TAG = `[DEMO] ${SCENARIO}`;
const LEDGER =
  'Жишиг санхүүгийн өгөгдөл. Жинхэнэ мөнгөн гүйлгээ, QPay нэхэмжлэл, банкны шилжүүлэг биш.';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = join(HERE, '../.backups');

type RoundFull = ProductRound & {
  product: {
    id: string;
    name: string;
    ownerKind: string;
    variants: Pick<ProductVariant, 'kind' | 'value' | 'sortOrder'>[];
  };
  optionPrices: {
    kind: string;
    value: string;
    skuKey: string;
    selections: unknown;
    sellPrice: number;
    costPrice: number;
  }[];
  skuStocks: {
    skuKey: string;
    selections: unknown;
    stock: number;
  }[];
  cargoFees: { skuKey: string; selections: unknown; cargoFee: number }[];
};

function noteOf(key: string, detail: string): string {
  return `${TAG} ${key} — ${detail}. ${LEDGER}`;
}

function payNote(key: string, detail: string): string {
  return `${TAG} ${key} ${detail}. ${LEDGER}`;
}

function dbHost(): { host: string; database: string } {
  const u = new URL(env.DATABASE_URL);
  const database = u.pathname.replace(/^\//, '').split('?')[0] ?? '';
  return { host: u.hostname, database };
}

function firstSelections(round: RoundFull): Record<string, string> {
  const options = optionsFromVariants(round.product.variants);
  if (options.length === 0) return {};
  const fromSku = round.skuStocks[0] ? selectionsOf(round.skuStocks[0].selections) : null;
  if (fromSku && options.every((o) => fromSku[o.name])) return fromSku;
  return Object.fromEntries(options.map((o) => [o.name, o.values[0]!]));
}

function unitPriceOf(round: RoundFull, selections: Record<string, string>): number {
  return resolveOptionPrice(round, round.optionPrices, selections).sellPrice;
}

function sellableSelections(round: RoundFull): Record<string, string> | null {
  const options = optionsFromVariants(round.product.variants);
  if (options.length === 0) return round.sellPrice >= 10_000 ? {} : null;
  let sel = firstSelections(round);
  for (const opt of options) {
    let bestVal = sel[opt.name]!;
    let bestPrice = unitPriceOf(round, sel);
    for (const value of opt.values) {
      const trial = { ...sel, [opt.name]: value };
      const price = unitPriceOf(round, trial);
      const better =
        price >= 10_000 &&
        (bestPrice < 10_000 ||
          Math.abs(price - round.sellPrice) < Math.abs(bestPrice - round.sellPrice));
      if (better) {
        bestVal = value;
        bestPrice = price;
      }
    }
    sel = { ...sel, [opt.name]: bestVal };
  }
  return unitPriceOf(round, sel) >= 10_000 ? sel : null;
}

async function cloneClosed(source: RoundFull, closeAt: Date): Promise<RoundFull> {
  const max = await prisma.productRound.aggregate({
    where: { productId: source.productId },
    _max: { roundNo: true },
  });
  const created = await prisma.productRound.create({
    data: {
      productId: source.productId,
      roundNo: (max._max.roundNo ?? 0) + 1,
      costPrice: source.costPrice,
      sellPrice: source.sellPrice,
      cargoFee: source.cargoFee,
      stock: 0,
      reserved: 0,
      available: 0,
      closeAt,
      leadMinDays: source.leadMinDays,
      leadMaxDays: source.leadMaxDays,
      status: 'CLOSED',
      ownerKind: 'SHOP',
      ownerAdminId: null,
      note: `${TAG} cloned closed round from ${source.id}`,
    },
  });
  if (source.optionPrices.length > 0) {
    await prisma.roundOptionPrice.createMany({
      data: source.optionPrices.map((p) => ({
        roundId: created.id,
        kind: p.kind,
        value: p.value,
        skuKey: p.skuKey,
        selections: p.selections as object,
        sellPrice: p.sellPrice,
        costPrice: p.costPrice,
      })),
    });
  }
  if (source.cargoFees.length > 0) {
    await prisma.roundCargoFee.createMany({
      data: source.cargoFees.map((c) => ({
        roundId: created.id,
        skuKey: c.skuKey,
        selections: (c.selections ?? {}) as object,
        cargoFee: c.cargoFee,
      })),
    });
  }
  return (await prisma.productRound.findUniqueOrThrow({
    where: { id: created.id },
    include: {
      product: { select: { id: true, name: true, ownerKind: true, variants: true } },
      optionPrices: true,
      skuStocks: true,
      cargoFees: true,
    },
  })) as RoundFull;
}

async function cloneReady(source: RoundFull, stock: number): Promise<RoundFull> {
  const max = await prisma.productRound.aggregate({
    where: { productId: source.productId },
    _max: { roundNo: true },
  });
  const created = await prisma.productRound.create({
    data: {
      productId: source.productId,
      roundNo: (max._max.roundNo ?? 0) + 1,
      costPrice: source.costPrice,
      sellPrice: source.sellPrice,
      cargoFee: source.cargoFee,
      stock,
      reserved: 0,
      available: stock,
      closeAt: null,
      leadMinDays: source.leadMinDays,
      leadMaxDays: source.leadMaxDays,
      status: 'ACTIVE',
      ownerKind: 'SHOP',
      ownerAdminId: null,
      note: `${TAG} cloned ready round from ${source.id}`,
    },
  });
  const selections = firstSelections(source);
  if (Object.keys(selections).length > 0) {
    const skuKey = skuKeyOf(selections);
    await prisma.roundSkuStock.create({
      data: {
        roundId: created.id,
        skuKey,
        selections,
        stock,
        reserved: 0,
        available: stock,
      },
    });
  }
  return (await prisma.productRound.findUniqueOrThrow({
    where: { id: created.id },
    include: {
      product: { select: { id: true, name: true, ownerKind: true, variants: true } },
      optionPrices: true,
      skuStocks: true,
      cargoFees: true,
    },
  })) as RoundFull;
}

async function findOrder(key: string) {
  return prisma.order.findFirst({
    where: { note: { contains: `${TAG} ${key} ` }, deletedAt: null },
    include: {
      items: true,
      payments: true,
      customer: { select: { name: true, phone: true } },
    },
  });
}

async function backdateOrder(orderId: string, when: Date) {
  await prisma.order.update({
    where: { id: orderId },
    data: { createdAt: when, updatedAt: when },
  });
}

async function backdatePayments(orderId: string, when: Date, exceptNewest = 0) {
  const rows = await prisma.payment.findMany({
    where: { orderId },
    orderBy: { createdAt: 'asc' },
  });
  const cutoff = rows.length - exceptNewest;
  for (let i = 0; i < cutoff; i++) {
    await prisma.payment.update({
      where: { id: rows[i]!.id },
      data: { createdAt: when },
    });
  }
}

async function pay(
  orderId: string,
  amount: number,
  key: string,
  detail: string,
  payeeKind?: 'SHOP' | 'LEASING',
) {
  if (amount <= 0) return;
  await withRetry(() =>
    recordPayment({
      orderId,
      kind: 'PAYMENT',
      amount,
      method: 'OTHER',
      reference: `${SCENARIO}-${key}`,
      note: payNote(key, detail),
      actor: ACTOR,
      payeeKind: payeeKind ?? null,
    }),
  );
}

async function placeClosed(opts: {
  key: string;
  detail: string;
  customerId: string;
  round: RoundFull;
  extraRounds?: RoundFull[];
  leasing?: boolean;
  operatorId?: string;
  createdAt?: Date;
  qty?: number;
}) {
  const existing = await findOrder(opts.key);
  if (existing) return existing;
  const items = [opts.round, ...(opts.extraRounds ?? [])].map((round) => {
    const selections = sellableSelections(round) ?? firstSelections(round);
    return {
      productId: round.id,
      qty: opts.qty ?? 1,
      selections,
    };
  });
  const order = await withRetry(() =>
    createOrder({
      customerId: opts.customerId,
      items,
      note: noteOf(opts.key, opts.detail),
      actor: ACTOR,
      allowClosed: true,
      leasing: opts.leasing,
      now: opts.createdAt,
    }),
  );
  if (opts.operatorId && opts.leasing) {
    await prisma.order.update({
      where: { id: order.id },
      data: { leasingOperatorAdminId: opts.operatorId },
    });
  }
  await syncOrderCargoFee(prisma, order.id);
  if (opts.createdAt) await backdateOrder(order.id, opts.createdAt);
  return prisma.order.findFirstOrThrow({
    where: { id: order.id },
    include: { items: true, payments: true, customer: { select: { name: true, phone: true } } },
  });
}

async function walkTo(orderId: string, target: 'CONFIRMED' | 'IN_BATCH' | 'IN_TRANSIT') {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { status: true },
  });
  if (order.status === 'CANCELLED' || order.status === 'HANDED_OVER') return;
  const flow = ['NEW', 'CONFIRMED', 'IN_BATCH', 'IN_TRANSIT', 'ARRIVED', 'HANDED_OVER'] as const;
  const from = flow.indexOf(order.status as (typeof flow)[number]);
  const to = flow.indexOf(target);
  if (from < 0 || to <= from) return;
  for (let i = from + 1; i <= to; i++) {
    const next = flow[i]!;
    if (next === 'ARRIVED' || next === 'HANDED_OVER') break;
    const current = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    });
    if (current.status === next) continue;
    if (current.status === 'ARRIVED' || current.status === 'HANDED_OVER') return;
    await withRetry(() =>
      changeOrderStatus(orderId, next, {
        actor: ACTOR,
        reason: `${TAG} ${next}`,
      }),
    );
  }
}

async function attachAndPromote(
  orderId: string,
  roundIds: string[],
  batchId: string,
  stage: 'IN_TRANSIT',
) {
  await prisma.productRound.updateMany({
    where: { id: { in: roundIds } },
    data: { batchId },
  });
  for (const roundId of roundIds) {
    await withRetry(() =>
      prisma.$transaction(async (tx) => attachOrdersForRound(tx, roundId, batchId), {
        timeout: 20_000,
      }),
    );
  }
  await withRetry(() =>
    prisma.$transaction(
      async (tx) => promoteOrdersForBatchStage(tx, batchId, stage, ACTOR, [orderId]),
      { timeout: 20_000 },
    ),
  );
}

async function attachCollecting(orderId: string, roundIds: string[], batchId: string) {
  await prisma.productRound.updateMany({
    where: { id: { in: roundIds } },
    data: { batchId },
  });
  for (const roundId of roundIds) {
    await withRetry(() =>
      prisma.$transaction(async (tx) => attachOrdersForRound(tx, roundId, batchId), {
        timeout: 20_000,
      }),
    );
  }
  await walkTo(orderId, 'IN_BATCH');
}

function fail(err: unknown): never {
  const app = unwrapAppError(err);
  if (app) {
    console.error(JSON.stringify({ error: app.message, code: app.code, details: app.details }));
  } else if (err instanceof Error) {
    console.error(JSON.stringify({ error: err.message, stack: err.stack?.split('\n').slice(0, 6) }));
  } else {
    console.error(JSON.stringify({ error: String(err) }));
  }
  process.exit(1);
}

function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message} ${err.name}` : String(err);
  return /Transaction not found|Transaction API error|timed out|Unable to start a transaction|P2028|P2034|connection pool/i.test(msg);
}

async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isTransient(err) || i === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last;
}

async function retireCheap(key: string) {
  const order = await findOrder(key);
  if (!order) return;
  const tooCheap = order.items.some((item) => !item.cancelledAt && item.unitPrice < 10_000);
  if (!tooCheap) return;
  await prisma.itgelSettlement.updateMany({
    where: { sourceOrderId: order.id, status: { not: 'VOID' } },
    data: { status: 'VOID', remainingAmount: 0 },
  });
  const net = order.paidAmount - order.refundedAmount;
  if (net > 0) {
    await withRetry(() =>
      recordPayment({
        orderId: order.id,
        kind: 'REFUND',
        amount: net,
        method: 'OTHER',
        reference: `${SCENARIO}-${key}-VOID`,
        note: payNote(`${key}-VOID`, 'хямд SKU-г солих буцаалт — жинхэнэ мөнгө биш'),
        actor: ACTOR,
      }),
    );
  }
  const live = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    select: { status: true },
  });
  if (live.status !== 'CANCELLED' && live.status !== 'HANDED_OVER') {
    await withRetry(() =>
      changeOrderStatus(order.id, 'CANCELLED', {
        actor: ACTOR,
        reason: `${TAG} ${key} cheap SKU retired`,
      }),
    );
  }
  await prisma.order.update({
    where: { id: order.id },
    data: {
      deletedAt: new Date(),
      note: noteOf(`${key}-VOID`, 'хямд SKU-тай жишиг захиалгыг сольсон'),
    },
  });
}

async function main() {
  const fp = dbHost();
  if (!/supabase\.com$/i.test(fp.host)) {
    throw new Error(`DB host ${fp.host} is not the Itgel Supabase project.`);
  }
  const settings = await getSettings();
  if (!settings.storeName.includes('Итгэл')) {
    throw new Error(`storeName "${settings.storeName}" is not the Itgel store.`);
  }
  const leasingAdmin = await prisma.adminUser.findFirst({
    where: { role: 'LEASING', isActive: true },
    select: { id: true, name: true, role: true, tokenVersion: true },
  });
  const ownerAdmin = await prisma.adminUser.findFirst({
    where: { role: 'OWNER', isActive: true },
    select: { id: true, name: true, role: true, tokenVersion: true },
  });
  if (!leasingAdmin || !ownerAdmin) throw new Error('LEASING or OWNER admin missing.');

  mkdirSync(BACKUP_DIR, { recursive: true });
  const before = {
    scenario: SCENARIO,
    at: new Date().toISOString(),
    db: { host: fp.host, database: fp.database },
    storeName: settings.storeName,
    leasingSettlementAdminIdSet: Boolean(settings.leasingSettlementAdminId),
    orderCount: await prisma.order.count(),
    paymentCount: await prisma.payment.count(),
    settlementCount: await prisma.itgelSettlement.count(),
  };
  writeFileSync(join(BACKUP_DIR, `${SCENARIO}-before.json`), JSON.stringify(before, null, 2));

  console.log(
    JSON.stringify({
      ok: true,
      scenario: SCENARIO,
      dbHost: fp.host,
      dbName: fp.database,
      storeName: settings.storeName,
      leasingAdminName: leasingAdmin.name,
      ownerAdminName: ownerAdmin.name,
      settingsPatched: false,
    }),
  );

  const today = startOfUbDay(new Date());
  const gaps = leasingPayGapsOf(settings);
  const closeAt = addDays(today, 21);

  let customer = await prisma.customer.findFirst({
    where: { name: `${TAG} sandbox` },
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        name: `${TAG} sandbox`,
        phone: null,
        email: null,
        notifyPayment: false,
        notifyArrival: false,
        notifyPromo: false,
      },
    });
  }

  let collecting = await prisma.batch.findFirst({
    where: { name: `${TAG} collecting`, deletedAt: null },
  });
  if (!collecting) {
    collecting = await prisma.batch.create({
      data: { name: `${TAG} collecting`, stage: 'COLLECTING' },
    });
  }
  let transit = await prisma.batch.findFirst({
    where: { name: `${TAG} transit`, deletedAt: null },
  });
  if (!transit) {
    transit = await prisma.batch.create({
      data: { name: `${TAG} transit`, stage: 'IN_TRANSIT' },
    });
  }

  const existingDemoRounds = await prisma.productRound.findMany({
    where: { note: { startsWith: TAG }, deletedAt: null },
    include: {
      product: { select: { id: true, name: true, ownerKind: true, variants: true } },
      optionPrices: true,
      skuStocks: true,
      cargoFees: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const sources = (await prisma.productRound.findMany({
    where: {
      deletedAt: null,
      status: 'CLOSED',
      closeAt: { not: null },
      sellPrice: { gte: 10_000 },
      ownerKind: 'SHOP',
      product: { deletedAt: null, ownerKind: 'SHOP' },
    },
    include: {
      product: { select: { id: true, name: true, ownerKind: true, variants: true } },
      optionPrices: true,
      skuStocks: true,
      cargoFees: true,
    },
    orderBy: { sellPrice: 'desc' },
    take: 80,
  })) as RoundFull[];

  const unique: RoundFull[] = [];
  const seen = new Set<string>();
  for (const row of sources) {
    if (row.note?.startsWith(TAG)) continue;
    if (seen.has(row.productId)) continue;
    if (!sellableSelections(row)) continue;
    seen.add(row.productId);
    unique.push(row);
  }
  const cargoSource = unique.find((r) => r.cargoFee > 0) ?? unique[0];
  if (unique.length < 12 || !cargoSource) {
    throw new Error(`Need ≥12 unique priced shop products, got ${unique.length}.`);
  }

  const closedDemo = existingDemoRounds.filter((r) => r.closeAt !== null) as RoundFull[];
  const readyDemo = existingDemoRounds.find((r) => r.closeAt === null) as RoundFull | undefined;

  const needClosed = 12;
  while (closedDemo.length < needClosed) {
    const src = unique[closedDemo.length]!;
    closedDemo.push(await cloneClosed(src, closeAt));
  }
  const ready = readyDemo ?? (await cloneReady(unique[needClosed] ?? unique[0]!, 8));

  const [
    rS1, rS2, rS3, rS4a, rS4b, rL1, rL2, rL3, rL4, rL5, rXfer, rCargo,
  ] = closedDemo;

  async function sellableDemoRound(preferred: RoundFull | undefined): Promise<RoundFull> {
    if (preferred && sellableSelections(preferred)) return preferred;
    const have = closedDemo.find((r) => sellableSelections(r));
    if (have) return have;
    const src = unique.find((r) => sellableSelections(r));
    if (!src) throw new Error('No shop product with SKU priced ≥10,000₮.');
    const cloned = await cloneClosed(src, closeAt);
    closedDemo.push(cloned);
    return cloned;
  }

  await retireCheap('S1');
  const s1 = await placeClosed({
    key: 'S1',
    detail: 'урьдчилсан захиалга төлбөр хүлээгдэж байна',
    customerId: customer.id,
    round: await sellableDemoRound(rS1),
  });

  await retireCheap('S2');
  const s2 = await placeClosed({
    key: 'S2',
    detail: 'урьдчилсан захиалга хэсэгчилсэн төлбөртэй',
    customerId: customer.id,
    round: await sellableDemoRound(rS2),
  });
  if (s2.payments.length === 0) {
    const chunk = Math.min(Math.max(1, Math.floor(s2.subtotal / 3)), Math.max(1, s2.subtotal - 1));
    await pay(s2.id, chunk, 'S2', 'хэсэгчилсэн төлбөр');
  }

  await retireCheap('S3');
  const s3 = await placeClosed({
    key: 'S3',
    detail: 'урьдчилсан захиалга бүрэн төлсөн багцад орсон',
    customerId: customer.id,
    round: await sellableDemoRound(rS3),
  });
  if (s3.payments.length === 0) {
    await pay(s3.id, s3.subtotal, 'S3', 'бүтэн барааны үнэ');
  }
  {
    const live = await prisma.order.findUniqueOrThrow({ where: { id: s3.id } });
    if (live.status === 'NEW' && live.paidAmount >= live.subtotal) {
      await walkTo(s3.id, 'CONFIRMED');
    }
    const after = await prisma.order.findUniqueOrThrow({
      where: { id: s3.id },
      include: { items: true },
    });
    if (after.status === 'CONFIRMED') {
      await attachCollecting(
        s3.id,
        after.items.map((i) => i.roundId),
        collecting.id,
      );
    }
  }

  const s4 = await placeClosed({
    key: 'S4',
    detail: 'олон мөртэй зарим бараа ирсэн зарим нь замд',
    customerId: customer.id,
    round: rS4a!,
    extraRounds: [rS4b!],
  });
  if (s4.payments.length === 0) {
    await pay(s4.id, s4.subtotal, 'S4', 'бүтэн барааны үнэ');
  }
  {
    const live = await prisma.order.findUniqueOrThrow({ where: { id: s4.id }, include: { items: true } });
    if (live.status === 'NEW' && live.paidAmount >= live.subtotal) {
      await walkTo(s4.id, 'CONFIRMED');
    }
    const after = await prisma.order.findUniqueOrThrow({ where: { id: s4.id }, include: { items: true } });
    if (after.status === 'CONFIRMED' || after.status === 'IN_BATCH') {
      await attachAndPromote(s4.id, [rS4a!.id, rS4b!.id], transit.id, 'IN_TRANSIT');
    }
    const arrivedItems = await prisma.orderItem.findMany({ where: { orderId: s4.id } });
    const arrived = arrivedItems.some((i) => i.arrivedQty > 0);
    if (!arrived) {
      await withRetry(() =>
        registerBatchArrivals(
          transit.id,
          [{ roundId: rS4a!.id, selections: firstSelections(rS4a!), arrivedQty: 1 }],
          ACTOR,
        ),
      );
    }
  }

  const s5 = await placeClosed({
    key: 'S5',
    detail: 'бэлэн бараа бүрэн төлсөн хүлээлгэн өгсөн',
    customerId: customer.id,
    round: ready,
  });
  if (s5.payments.length === 0) {
    await pay(s5.id, s5.subtotal, 'S5', 'бэлэн бараа бүрэн төлөв');
  }
  {
    const afterPay = await prisma.order.findUniqueOrThrow({
      where: { id: s5.id },
      select: { status: true },
    });
    if (afterPay.status === 'NEW') {
      await withRetry(() =>
        changeOrderStatus(s5.id, 'CONFIRMED', {
          actor: ACTOR,
          reason: `${TAG} S5 confirm ready`,
        }),
      );
    }
    const items = await prisma.orderItem.findMany({
      where: { orderId: s5.id, cancelledAt: null },
      select: { id: true, arrivedAt: true, handedOverAt: true },
    });
    const toHand = items.filter((i) => i.arrivedAt && !i.handedOverAt).map((i) => i.id);
    if (toHand.length > 0) {
      await withRetry(() =>
        handOverItems({ itemIds: toHand, actor: ACTOR, note: `${TAG} S5 handover` }),
      );
    }
  }

  const l1Start = today;
  const l2Start = addDays(today, -(gaps[0] ?? 5));
  const l3Start = addDays(today, -((gaps[0] ?? 5) + 3));
  const l4Start = addDays(today, -((gaps[0] ?? 5) + (gaps[1] ?? 8)));
  const l5Start = addDays(today, -((gaps[0] ?? 5) + (gaps[1] ?? 8) + (gaps[2] ?? 8) + 7));

  const l1 = await placeClosed({
    key: 'L1',
    detail: 'лизинг шимтгэл төлсөн дараагийн төлөлт ирээдүйд',
    customerId: customer.id,
    round: rL1!,
    leasing: true,
    operatorId: leasingAdmin.id,
    createdAt: l1Start,
  });
  if (l1.payments.length === 0) {
    await pay(l1.id, l1.leasingFee, 'L1', 'лизингийн шимтгэл', 'LEASING');
  }

  const l2 = await placeClosed({
    key: 'L2',
    detail: 'лизинг шимтгэл төлсөн хуваарийн төлөлт өнөөдөр',
    customerId: customer.id,
    round: rL2!,
    leasing: true,
    operatorId: leasingAdmin.id,
    createdAt: l2Start,
  });
  if (l2.payments.length === 0) {
    await pay(l2.id, l2.leasingFee, 'L2', 'лизингийн шимтгэл', 'LEASING');
    await backdatePayments(l2.id, l2Start);
  }

  const l3 = await placeClosed({
    key: 'L3',
    detail: 'лизинг хуваарийн төлөлт хугацаа хэтэрсэн',
    customerId: customer.id,
    round: rL3!,
    leasing: true,
    operatorId: leasingAdmin.id,
    createdAt: l3Start,
  });
  if (l3.payments.length === 0) {
    await pay(l3.id, l3.leasingFee, 'L3', 'лизингийн шимтгэл', 'LEASING');
    await backdatePayments(l3.id, l3Start);
  }

  await retireCheap('L4');
  const l4 = await placeClosed({
    key: 'L4',
    detail: 'өмнөх төлөлтүүд төлөгдсөн өнөөдрийнх хэсэгчилсэн',
    customerId: customer.id,
    round: await sellableDemoRound(rL4),
    leasing: true,
    operatorId: leasingAdmin.id,
    createdAt: l4Start,
  });
  if (l4.payments.length === 0) {
    const plan = buildLeasingPayPlan({
      isLeasing: true,
      createdAt: l4Start,
      subtotal: l4.subtotal,
      leasingFee: l4.leasingFee,
      paidAmount: 0,
      refundedAmount: 0,
      payGaps: gaps,
    })!;
    const fee = plan.steps[0]!.amount;
    const firstInst = plan.steps[1]!.amount;
    const secondInst = plan.steps[2]!.amount;
    await pay(l4.id, fee, 'L4', 'лизингийн шимтгэл', 'LEASING');
    await pay(l4.id, firstInst, 'L4', 'өмнөх хуваарийн төлөлт', 'LEASING');
    const partial = Math.max(1, Math.floor(secondInst / 2));
    await pay(l4.id, partial, 'L4', 'өнөөдрийн хуваарь хэсэгчилсэн', 'LEASING');
    await backdatePayments(l4.id, addDays(l4Start, gaps[0] ?? 5), 1);
  }

  const l5 = await placeClosed({
    key: 'L5',
    detail: 'лизинг хэрэглэгчийн төлбөр дууссан бараа хүлээлгэн өгсөн',
    customerId: customer.id,
    round: rL5!,
    leasing: true,
    operatorId: leasingAdmin.id,
    createdAt: l5Start,
  });
  if (l5.payments.length === 0) {
    await pay(l5.id, l5.leasingFee + l5.subtotal, 'L5', 'шимтгэл+үндсэн бүрэн', 'LEASING');
    await backdatePayments(l5.id, addDays(l5Start, (gaps[0] ?? 5) + (gaps[1] ?? 8) + (gaps[2] ?? 8)));
  }
  {
    const live = await prisma.order.findUniqueOrThrow({ where: { id: l5.id } });
    if (live.status === 'NEW') await walkTo(l5.id, 'CONFIRMED');
    const after = await prisma.order.findUniqueOrThrow({ where: { id: l5.id } });
    if (after.status === 'CONFIRMED' || after.status === 'IN_BATCH') {
      await attachAndPromote(l5.id, [rL5!.id], transit.id, 'IN_TRANSIT');
    }
    const arrivedItems = await prisma.orderItem.findMany({ where: { orderId: l5.id } });
    if (!arrivedItems.some((i) => i.arrivedQty > 0)) {
      await withRetry(() =>
        registerBatchArrivals(
          transit.id,
          [{ roundId: rL5!.id, selections: firstSelections(rL5!), arrivedQty: 1 }],
          ACTOR,
        ),
      );
    }
    const items = await prisma.orderItem.findMany({
      where: { orderId: l5.id, cancelledAt: null },
      select: { id: true, arrivedAt: true, handedOverAt: true },
    });
    const toHand = items.filter((i) => i.arrivedAt && !i.handedOverAt).map((i) => i.id);
    if (toHand.length > 0) {
      await withRetry(() =>
        handOverItems({ itemIds: toHand, actor: ACTOR, note: `${TAG} L5 handover` }),
      );
    }
  }

  const exCancel = await placeClosed({
    key: 'EX-CANCEL',
    detail: 'төлөөгүй бэлэн захиалга цуцлагдаж нөөц чөлөөлөгдөнө',
    customerId: customer.id,
    round: ready,
  });
  if (exCancel.status !== 'CANCELLED') {
    await withRetry(() =>
      changeOrderStatus(exCancel.id, 'CANCELLED', {
        actor: ACTOR,
        reason: `${TAG} unpaid ready cancel stock release`,
      }),
    );
  }

  const exXfer = await placeClosed({
    key: 'EX-XFER',
    detail: 'лизингийн барааг бэлэн бараанд шилжүүлэх эх захиалга',
    customerId: customer.id,
    round: rXfer!,
    leasing: true,
    operatorId: leasingAdmin.id,
  });
  if (exXfer.payments.length === 0) {
    await pay(exXfer.id, exXfer.leasingFee, 'EX-XFER', 'шимтгэл шилжүүлэхээс өмнө', 'LEASING');
  }
  const transferred = await prisma.orderItem.findFirst({
    where: { orderId: exXfer.id, transferredAt: { not: null } },
  });
  const existingXferLine = await prisma.readyStockTransferLine.findFirst({
    where: { transfer: { sourceOrderId: exXfer.id } },
    select: { destRoundId: true },
  });
  let resaleDestRoundId: string | null = existingXferLine?.destRoundId ?? null;
  if (!transferred) {
    const live = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: exXfer.id, cancelledAt: null },
    });
    const xfer = await withRetry(() =>
      executeReadyTransfer({
        orderId: exXfer.id,
        ownerAdminId: leasingAdmin.id,
        reason: `${TAG} leasing item to ready resale`,
        lines: [{ orderItemId: live.id, qty: 1, resaleUnitPrice: live.unitPrice }],
        actor: ACTOR,
      }),
    );
    resaleDestRoundId = xfer.destRoundIds[0] ?? null;
  }
  if (!(await findOrder('EX-RESALE')) && resaleDestRoundId) {
    const dest = await prisma.productRound.findUniqueOrThrow({
      where: { id: resaleDestRoundId },
      include: {
        product: { include: { variants: true } },
        optionPrices: true,
        skuStocks: true,
      },
    });
    const flags = checkoutFlagsForGroup('LEASING', false);
    const mapped = snapshotOrderLines(
      [
        {
          productId: dest.id,
          qty: 1,
          selections: firstSelections({
            ...dest,
            product: {
              id: dest.product.id,
              name: dest.product.name,
              ownerKind: dest.product.ownerKind,
              variants: dest.product.variants,
            },
            cargoFees: [],
          } as RoundFull),
        },
      ],
      new Map([[dest.id, dest]]),
    );
    const created = await withRetry(() =>
      prisma.$transaction(
        async (tx) => {
          for (const line of mapped) {
            await reserveReadyStock(tx, dest, line.qty, line.selections);
            line.stockHold = 'RESERVED';
          }
          return createOrderWithUniqueCode(tx, {
            customerId: customer.id,
            subtotal: mapped.reduce((s, i) => s + i.unitPrice * i.qty, 0),
            isLeasing: flags.isLeasing,
            leasingFee: 0,
            payeeKind: flags.payeeKind,
            note: noteOf('EX-RESALE', 'лизингээс шилжсэн бэлэн барааны дахин худалдаа'),
            items: mapped,
          });
        },
        { timeout: 20_000 },
      ),
    );
    await pay(created.id, created.subtotal, 'EX-RESALE', 'бэлэн дахин борлуулалт', 'LEASING');
    const st = await prisma.order.findUniqueOrThrow({
      where: { id: created.id },
      select: { status: true },
    });
    if (st.status === 'NEW') {
      await withRetry(() =>
        changeOrderStatus(created.id, 'CONFIRMED', {
          actor: ACTOR,
          reason: `${TAG} EX-RESALE confirm`,
        }),
      );
    }
  }

  const exRefund = await placeClosed({
    key: 'EX-REFUND',
    detail: 'хэсэгчилсэн буцаалт бүртгэсэн бэлэн захиалга',
    customerId: customer.id,
    round: ready,
  });
  if (!exRefund.payments.some((p) => p.kind === 'PAYMENT')) {
    await pay(exRefund.id, exRefund.subtotal, 'EX-REFUND', 'бүрэн төлөв буцаалтын өмнө');
    const st = await prisma.order.findUniqueOrThrow({
      where: { id: exRefund.id },
      select: { status: true },
    });
    if (st.status === 'NEW') {
      await withRetry(() =>
        changeOrderStatus(exRefund.id, 'CONFIRMED', {
          actor: ACTOR,
          reason: `${TAG} EX-REFUND confirm`,
        }),
      );
    }
  }
  if (!exRefund.payments.some((p) => p.kind === 'REFUND')) {
    const refundAmt = Math.max(1000, Math.floor(exRefund.subtotal / 10));
    await withRetry(() =>
      recordPayment({
        orderId: exRefund.id,
        kind: 'REFUND',
        amount: refundAmt,
        method: 'OTHER',
        reference: `${SCENARIO}-EX-REFUND`,
        note: payNote('EX-REFUND', 'хэсэгчилсэн буцаалт — банкны гүйлгээ биш'),
        actor: ACTOR,
      }),
    );
  }

  await retireCheap('EX-CARGO');
  const exCargo = await placeClosed({
    key: 'EX-CARGO',
    detail: 'лизингийн үндсэн төлбөр болон Итгэлд очих карго тусдаа',
    customerId: customer.id,
    round: await sellableDemoRound(
      closedDemo.find((r) => r.cargoFee > 0 && sellableSelections(r)) ?? rCargo,
    ),
    leasing: true,
    operatorId: leasingAdmin.id,
  });
  const cargoFresh = await prisma.order.findUniqueOrThrow({ where: { id: exCargo.id } });
  if (exCargo.payments.length === 0) {
    await pay(exCargo.id, cargoFresh.leasingFee, 'EX-CARGO', 'лизингийн шимтгэл', 'LEASING');
  }
  {
    const live = await prisma.order.findUniqueOrThrow({
      where: { id: exCargo.id },
      include: { items: true, payments: true },
    });
    if (live.cargoFee === 0) {
      const srcCargo = sources.find((r) => r.cargoFee > 0)?.cargoFee ?? 0;
      const item = live.items[0];
      if (srcCargo > 0 && item) {
        await prisma.productRound.update({
          where: { id: item.roundId },
          data: { cargoFee: srcCargo },
        });
        await syncOrderCargoFee(prisma, live.id);
      }
    }
    const after = await prisma.order.findUniqueOrThrow({ where: { id: exCargo.id } });
    const shopPaid = after.shopPaidAmount ?? 0;
    if (after.cargoFee > shopPaid) {
      await pay(after.id, after.cargoFee - shopPaid, 'EX-CARGO', 'дэлгүүрийн карго', 'SHOP');
    }
  }

  await prisma.productRound.update({
    where: { id: ready.id },
    data: { status: 'HIDDEN' },
  });

  const mapState = {
    L1: 'OPEN_TODAY',
    L2: 'PENDING_BANK',
    L3: 'REJECTED_OPEN',
    L4: 'PAID_TODAY',
    L5: 'PAID_YESTERDAY',
  } as const;

  for (const [key, state] of Object.entries(mapState)) {
    const order = await findOrder(key);
    if (!order) continue;
    const settlement = await prisma.itgelSettlement.findFirst({
      where: { sourceOrderId: order.id, status: { not: 'VOID' } },
    });
    if (!settlement) continue;

    if (state === 'OPEN_TODAY') continue;

    if (state === 'PENDING_BANK' && settlement.status === 'OPEN') {
      await withRetry(() =>
        createSettlementPayment({
          settlementIds: [settlement.id],
          method: 'BANK_TRANSFER',
          ownerAdminId: leasingAdmin.id,
          actorAdminId: ownerAdmin.id,
          role: 'OWNER',
          bankRef: `${SCENARIO}-${key}-PENDING`,
          bankDate: today,
          note: payNote(key, 'дансны шилжүүлэг мэдүүлсэн — баталгаа хүлээнэ. Жинхэнэ банкны гүйлгээ биш'),
        }),
      );
    }

    if (state === 'REJECTED_OPEN' && settlement.status === 'OPEN') {
      const created = await withRetry(() =>
        createSettlementPayment({
          settlementIds: [settlement.id],
          method: 'BANK_TRANSFER',
          ownerAdminId: leasingAdmin.id,
          actorAdminId: ownerAdmin.id,
          role: 'OWNER',
          bankRef: `${SCENARIO}-${key}-REJECT`,
          bankDate: addDays(today, -1),
          note: payNote(key, 'шилжүүлэг буцаагдана. Жинхэнэ банкны гүйлгээ биш'),
        }),
      );
      await withRetry(() =>
        rejectBankSettlementPayment({
          paymentId: created.payment.id,
          actorAdminId: ownerAdmin.id,
          reason: `${TAG} ${key} demo reject — жинхэнэ гүйлгээ биш`,
        }),
      );
      await prisma.itgelSettlement.update({
        where: { id: settlement.id },
        data: { confirmedAt: addDays(today, -3) },
      });
    }

    if (state === 'PAID_TODAY' && settlement.status === 'OPEN') {
      const created = await withRetry(() =>
        createSettlementPayment({
          settlementIds: [settlement.id],
          method: 'BANK_TRANSFER',
          ownerAdminId: leasingAdmin.id,
          actorAdminId: ownerAdmin.id,
          role: 'OWNER',
          bankRef: `${SCENARIO}-${key}-PAID-TODAY`,
          bankDate: today,
          note: payNote(key, 'өнөөдөр баталгаажуулсан жишиг шилжүүлэг'),
        }),
      );
      await withRetry(() =>
        confirmBankSettlementPayment({
          paymentId: created.payment.id,
          actorAdminId: ownerAdmin.id,
        }),
      );
    }

    if (state === 'PAID_YESTERDAY' && settlement.status === 'OPEN') {
      const yesterday = addDays(today, -1);
      await prisma.itgelSettlement.update({
        where: { id: settlement.id },
        data: { confirmedAt: yesterday },
      });
      const created = await withRetry(() =>
        createSettlementPayment({
          settlementIds: [settlement.id],
          method: 'BANK_TRANSFER',
          ownerAdminId: leasingAdmin.id,
          actorAdminId: ownerAdmin.id,
          role: 'OWNER',
          bankRef: `${SCENARIO}-${key}-PAID-YDAY`,
          bankDate: yesterday,
          note: payNote(key, 'өчигдөр баталгаажуулсан жишиг шилжүүлэг'),
        }),
      );
      await withRetry(() =>
        confirmBankSettlementPayment({
          paymentId: created.payment.id,
          actorAdminId: ownerAdmin.id,
        }),
      );
      await prisma.itgelSettlementPayment.update({
        where: { id: created.payment.id },
        data: { createdAt: yesterday, updatedAt: yesterday },
      });
    }
  }

  const report = await buildReport({
    gaps,
    today,
    leasingAdminId: leasingAdmin.id,
    customerId: customer.id,
  });
  writeFileSync(join(BACKUP_DIR, `${SCENARIO}-report.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

async function buildReport(input: {
  gaps: number[];
  today: Date;
  leasingAdminId: string;
  customerId: string;
}) {
  const keys = [
    'S1', 'S2', 'S3', 'S4', 'S5',
    'L1', 'L2', 'L3', 'L4', 'L5',
    'EX-CANCEL', 'EX-XFER', 'EX-RESALE', 'EX-REFUND', 'EX-CARGO',
  ];
  const orders = [];
  for (const key of keys) {
    const order = await findOrder(key);
    if (!order) {
      orders.push({ key, missing: true });
      continue;
    }
    const plan = buildLeasingPayPlan({
      ...order,
      payGaps: input.gaps,
    });
    const view = leasingView(order);
    const next = plan?.steps.find((s) => s.remaining > 0);
    orders.push({
      key,
      code: order.code,
      status: order.status,
      isLeasing: order.isLeasing,
      payeeKind: order.payeeKind,
      products: order.items.map((i) => ({
        name: i.nameSnapshot,
        qty: i.qty,
        unitPrice: i.unitPrice,
        arrivedQty: i.arrivedQty,
        arrivedAt: i.arrivedAt,
        handedOverAt: i.handedOverAt,
        cancelledAt: i.cancelledAt,
      })),
      subtotal: order.subtotal,
      leasingFee: order.leasingFee,
      cargoFee: order.cargoFee,
      paidAmount: order.paidAmount,
      refundedAmount: order.refundedAmount,
      dueAmount: order.dueAmount,
      nextDueDay: next?.dueDay ?? null,
      nextDueAmount: next?.remaining ?? 0,
      nextDueKind: next?.kind ?? null,
      feePaid: view.feePaid,
      createdAt: order.createdAt,
      plan: plan
        ? {
            dueToday: plan.dueToday,
            overdue: plan.overdue,
            steps: plan.steps.map((s) => ({
              kind: s.kind,
              dueDay: s.dueDay,
              amount: s.amount,
              paidAmount: s.paidAmount,
              remaining: s.remaining,
              status: s.status,
            })),
          }
        : null,
    });
  }

  const from = startOfUbDay(input.today);
  const to = endOfUbDay(input.today);
  const demoPaymentsToday = await prisma.payment.findMany({
    where: {
      note: { contains: TAG },
      kind: 'PAYMENT',
      createdAt: { gte: from, lte: to },
      order: { deletedAt: null, note: { contains: TAG } },
    },
    select: { amount: true, orderId: true, payeeKind: true },
  });
  const collectedToday = demoPaymentsToday.reduce((s, p) => s + p.amount, 0);

  let dueTodayAmount = 0;
  let overdueAmount = 0;
  for (const row of orders) {
    if (!('plan' in row) || !row.plan) continue;
    for (const step of row.plan.steps) {
      if (step.status === 'due_today') dueTodayAmount += step.remaining;
      if (step.status === 'overdue') overdueAmount += step.remaining;
    }
  }

  const summary = await daySummary({
    ownerAdminId: input.leasingAdminId,
    day: input.today,
  });
  const demoSettlements = await prisma.itgelSettlement.findMany({
    where: { sourceOrder: { note: { contains: TAG } } },
  });
  const pendingBank = demoSettlements
    .filter((s) => s.status === 'PENDING_BANK')
    .reduce((s, r) => s + r.remainingAmount, 0);
  const unpaid = demoSettlements
    .filter((s) => s.status === 'OPEN' || s.status === 'INVOICED' || s.status === 'PENDING_BANK')
    .reduce((s, r) => s + r.remainingAmount, 0);
  const paidToday = await prisma.itgelSettlementPayment.aggregate({
    where: {
      ownerAdminId: input.leasingAdminId,
      status: 'CONFIRMED',
      note: { contains: TAG },
      createdAt: { gte: from, lte: to },
    },
    _sum: { amount: true },
  });
  const paidYesterday = await prisma.itgelSettlementPayment.aggregate({
    where: {
      ownerAdminId: input.leasingAdminId,
      status: 'CONFIRMED',
      note: { contains: TAG },
      createdAt: { gte: addDays(from, -1), lt: from },
    },
    _sum: { amount: true },
  });

  return {
    scenario: SCENARIO,
    ubDay: ubDateString(input.today),
    customer: `${TAG} sandbox`,
    customerHasPhone: false,
    orders,
    customerToday: {
      dueTodayAmount,
      collectedTodayDemoPayments: collectedToday,
      overdueAmount,
    },
    itgel: {
      daySummaryAmount: summary.amount,
      daySummaryPaid: summary.paidAmount,
      daySummaryRemaining: summary.remainingAmount,
      priorUnpaidAmount: summary.priorUnpaidAmount,
      demoPaidToday: paidToday._sum.amount ?? 0,
      demoPaidYesterday: paidYesterday._sum.amount ?? 0,
      demoPendingBank: pendingBank,
      demoUnpaidTotal: unpaid,
      demoSettlementCount: demoSettlements.length,
      statuses: demoSettlements.map((s) => ({
        orderCode: s.sourceOrderCode,
        status: s.status,
        amount: s.amount,
        paidAmount: s.paidAmount,
        remainingAmount: s.remainingAmount,
        confirmedAt: s.confirmedAt,
      })),
    },
    impact:
      'Demo orders/payments/settlements are extra rows tagged [DEMO] DEMO-20260921-A. They add to live totals for unpaid, due-today, overdue, Itgel remaining, and ready stock on cloned HIDDEN rounds. They do not overwrite real customer/order/payment rows. S1 is NEW unpaid and may be auto-cancelled after unpaidCancelHours.',
    hideArchive: [
      'Do not delete Payment/ItgelSettlement rows (audit).',
      `Set Order.deletedAt = now() where note contains "${TAG}".`,
      `Hide/archive ProductRound where note starts with "${TAG}". Soft-delete the ${TAG} collecting/transit batches.`,
      `Keep the "${TAG} sandbox" customer (no phone) or rename it archived.`,
      'Do not PATCH Setting.leasingSettlementAdminId or disable QPay/SMS.',
    ],
  };
}

main()
  .catch(fail)
  .finally(() => prisma.$disconnect());
