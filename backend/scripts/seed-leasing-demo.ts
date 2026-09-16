/**
 * Лизингийн админд туршилтын өгөгдөл нэмнэ. Зөвхөн локал Postgres.
 * Дахин ажиллуулахад өмнөх демо мөрүүдийг сольно.
 *
 *   npx tsx scripts/seed-leasing-demo.ts
 */
const LOCAL_DB = 'postgresql://itgel:itgel@localhost:5432/itgel?schema=public';
process.env.DATABASE_URL = process.env.SEED_DATABASE_URL ?? LOCAL_DB;
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.SMS_PROVIDER = 'console';
process.env.SHOP_SMS_PROVIDER = 'console';
process.env.QPAY_ENABLED = 'false';
process.env.LEASING_QPAY_ENABLED = 'false';

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) {
  console.error('Энэ скрипт зөвхөн локал бааз дээр ажиллана.');
  process.exit(1);
}

export {};

const { PrismaClient } = await import('@prisma/client');
const { generateOrderCode } = await import('../src/lib/code.js');
const { addDays, startOfUbDay } = await import('../src/lib/date.js');
const { leasingFeeOf, parseLeasingFeeTiers } = await import('../src/lib/leasing.js');
const { optionCombinations, skuKeyOf } = await import('../src/lib/skuStock.js');
const { recalcOrderTotals } = await import('../src/services/money.js');
const { executeReadyTransfer } = await import('../src/services/readyTransfer.js');

type OrderStatus =
  | 'NEW'
  | 'CONFIRMED'
  | 'IN_BATCH'
  | 'IN_TRANSIT'
  | 'ARRIVED'
  | 'HANDED_OVER'
  | 'CANCELLED';

const prisma = new PrismaClient();
const now = new Date();
const today = startOfUbDay(now);
const DEMO_MAIL = '@leasing-demo.local';
const DEMO_PREFIX = 'ЛД ·';

const CUSTOMERS = [
  { phone: '89001001', name: 'Л. Оюун', email: `oyun${DEMO_MAIL}` },
  { phone: '89001002', name: 'Л. Ганбат', email: `ganbat${DEMO_MAIL}` },
  { phone: '89001003', name: 'Л. Ариунаа', email: `ariunaa${DEMO_MAIL}` },
  { phone: '89001004', name: 'Л. Мөнхбат', email: `munkhbat${DEMO_MAIL}` },
  { phone: '89001005', name: 'Л. Номин', email: `nomin${DEMO_MAIL}` },
  { phone: '89001006', name: 'Л. Батжаргал', email: `batjargal${DEMO_MAIL}` },
  { phone: '89001007', name: 'Л. Саран', email: `saran${DEMO_MAIL}` },
  { phone: '89001008', name: 'Л. Тэмүүлэн', email: `temuulen${DEMO_MAIL}` },
  { phone: '89001009', name: 'Л. Энхжин', email: `enkhjin${DEMO_MAIL}` },
  { phone: '89001010', name: 'Л. Халиун', email: `khaliun${DEMO_MAIL}` },
];

async function wipePrevious() {
  const customers = await prisma.customer.findMany({
    where: { OR: [{ email: { endsWith: DEMO_MAIL } }, { phone: { startsWith: '89001' } }] },
    select: { id: true },
  });
  const customerIds = customers.map((c) => c.id);
  const orders = customerIds.length
    ? await prisma.order.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } })
    : [];
  const orderIds = orders.map((o) => o.id);
  const transfers = orderIds.length
    ? await prisma.readyStockTransfer.findMany({
        where: { sourceOrderId: { in: orderIds } },
        include: { lines: true },
      })
    : [];
  const destProductIds = [...new Set(transfers.flatMap((t) => t.lines.map((l) => l.destProductId)))];

  if (orderIds.length) {
    await prisma.readyStockTransferLine.deleteMany({
      where: { transfer: { sourceOrderId: { in: orderIds } } },
    });
    await prisma.orderItem.updateMany({
      where: { orderId: { in: orderIds } },
      data: { readyTransferId: null },
    });
    await prisma.readyStockTransfer.deleteMany({ where: { sourceOrderId: { in: orderIds } } });
    await prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (customerIds.length) {
    await prisma.phoneOtp.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.emailOtp.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  }

  const named = await prisma.product.findMany({
    where: { name: { startsWith: DEMO_PREFIX } },
    select: { id: true },
  });
  const productIds = [...new Set([...named.map((p) => p.id), ...destProductIds])];
  if (productIds.length) {
    const rounds = await prisma.productRound.findMany({
      where: { productId: { in: productIds } },
      select: { id: true },
    });
    const roundIds = rounds.map((r) => r.id);
    if (roundIds.length) {
      await prisma.roundSkuStock.deleteMany({ where: { roundId: { in: roundIds } } });
      await prisma.roundOptionPrice.deleteMany({ where: { roundId: { in: roundIds } } });
      await prisma.roundCargoFee.deleteMany({ where: { roundId: { in: roundIds } } });
      await prisma.productRound.deleteMany({ where: { id: { in: roundIds } } });
    }
    await prisma.productVariant.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.sizeChartRow.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  }

  await prisma.batch.deleteMany({ where: { name: { startsWith: DEMO_PREFIX } } });
}

function img(label: string) {
  return `https://placehold.co/800x800/1C1917/FFFFFF?text=${encodeURIComponent(label)}`;
}

async function uniqueCode() {
  for (let i = 0; i < 8; i++) {
    const code = generateOrderCode();
    const exists = await prisma.order.findUnique({ where: { code } });
    if (!exists) return code;
  }
  throw new Error('Захиалгын код үүсгэж чадсангүй.');
}

async function createReadyProduct(input: {
  adminId: string;
  categoryId: string;
  name: string;
  status: 'ACTIVE' | 'HIDDEN' | 'DRAFT' | 'SOLD_OUT';
  sellPrice: number;
  options?: { name: string; values: string[] }[];
  stock: number;
}) {
  const combos = optionCombinations(input.options);
  const skuRows = combos.map((selections) => ({
    skuKey: skuKeyOf(selections),
    selections,
    stock: Math.max(0, Math.floor(input.stock / Math.max(1, combos.length))),
  }));
  const stock = skuRows.length ? skuRows.reduce((s, r) => s + r.stock, 0) : input.stock;

  const product = await prisma.product.create({
    data: {
      name: `${DEMO_PREFIX}${input.name}`,
      description: `${input.name} — лизингийн эзэмшлийн бэлэн бараа (туршилт).`,
      categoryId: input.categoryId,
      images: [img(input.name)],
      ownerKind: 'LEASING',
      ownerAdminId: input.adminId,
      variants: {
        create: (input.options ?? []).flatMap((opt, oi) =>
          opt.values.map((value, vi) => ({
            kind: opt.name,
            value,
            sortOrder: oi * 100 + vi,
          })),
        ),
      },
    },
  });
  const round = await prisma.productRound.create({
    data: {
      productId: product.id,
      roundNo: 1,
      costPrice: 0,
      sellPrice: input.sellPrice,
      stock,
      closeAt: null,
      status: input.status,
      ownerKind: 'LEASING',
      ownerAdminId: input.adminId,
      note: 'Лизинг демо бэлэн бараа',
      skuStocks: skuRows.length ? { create: skuRows } : undefined,
    },
  });
  return { product, round };
}

type RoundRef = {
  id: string;
  productId: string;
  sellPrice: number;
  costPrice: number;
  closeAt: Date | null;
  leadMinDays: number;
  leadMaxDays: number;
};

async function createLeasingOrder(input: {
  customerId: string;
  round: RoundRef;
  productName: string;
  selections?: Record<string, string>;
  qty: number;
  status: OrderStatus;
  createdAt: Date;
  paid: number;
  leasingFee: number;
  batchId?: string | null;
  note?: string;
}) {
  const unit = input.round.sellPrice;
  const subtotal = unit * input.qty;
  const selections = input.selections ?? {};
  const flow: OrderStatus[] = ['NEW', 'CONFIRMED', 'IN_BATCH', 'IN_TRANSIT', 'ARRIVED', 'HANDED_OVER'];
  const reached = (status: OrderStatus) =>
    input.status !== 'CANCELLED' && flow.indexOf(input.status) >= flow.indexOf(status);
  const at = (days: number) => addDays(input.createdAt, days);

  const order = await prisma.order.create({
    data: {
      code: await uniqueCode(),
      customerId: input.customerId,
      status: input.status,
      subtotal,
      leasingFee: input.leasingFee,
      isLeasing: true,
      payeeKind: 'LEASING',
      paidAmount: 0,
      refundedAmount: 0,
      dueAmount: subtotal + input.leasingFee,
      batchId: input.batchId ?? null,
      note: input.note ?? 'Лизинг демо захиалга',
      createdAt: input.createdAt,
      confirmedAt: reached('CONFIRMED') ? at(1) : null,
      inBatchAt: reached('IN_BATCH') ? at(2) : null,
      inTransitAt: reached('IN_TRANSIT') ? at(5) : null,
      arrivedAt: reached('ARRIVED') ? at(10) : null,
      arrivalNotifiedAt: reached('ARRIVED') ? at(10) : null,
      handedOverAt: reached('HANDED_OVER') ? at(12) : null,
      cancelledAt: input.status === 'CANCELLED' ? at(1) : null,
      items: {
        create: {
          roundId: input.round.id,
          productId: input.round.productId,
          nameSnapshot: input.productName,
          selections,
          size: selections['Хэмжээ'] ?? null,
          color: selections['Өнгө'] ?? null,
          qty: input.qty,
          unitPrice: unit,
          costPriceSnapshot: input.round.costPrice,
          arriveFrom:
            input.round.closeAt === null ? null : addDays(input.round.closeAt, input.round.leadMinDays),
          arriveTo:
            input.round.closeAt === null ? null : addDays(input.round.closeAt, input.round.leadMaxDays),
          arrivedAt: reached('ARRIVED') ? at(10) : null,
          arrivedQty: reached('ARRIVED') ? input.qty : 0,
          handedOverAt: reached('HANDED_OVER') ? at(12) : null,
        },
      },
    },
  });

  if (input.paid > 0) {
    await prisma.payment.create({
      data: {
        orderId: order.id,
        kind: 'PAYMENT',
        amount: input.paid,
        method: 'BANK_TRANSFER',
        note: 'Лизинг демо төлбөр',
        actor: 'system:leasing-demo',
        createdAt: addDays(input.createdAt, 1),
      },
    });
  }
  await prisma.$transaction((tx) => recalcOrderTotals(tx, order.id));
  return prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    include: { items: true },
  });
}

async function createResaleOrder(input: {
  customerId: string;
  round: { id: string; productId: string; sellPrice: number; costPrice: number };
  productName: string;
  selections?: Record<string, string>;
  qty: number;
  paid: boolean;
}) {
  const selections = input.selections ?? {};
  const subtotal = input.round.sellPrice * input.qty;
  const order = await prisma.order.create({
    data: {
      code: await uniqueCode(),
      customerId: input.customerId,
      status: input.paid ? 'CONFIRMED' : 'NEW',
      subtotal,
      leasingFee: 0,
      isLeasing: false,
      payeeKind: 'LEASING',
      paidAmount: 0,
      refundedAmount: 0,
      dueAmount: subtotal,
      note: 'Лизинг демо бэлэн борлуулалт',
      confirmedAt: input.paid ? now : null,
      paymentClaimedAt: input.paid ? null : now,
      items: {
        create: {
          roundId: input.round.id,
          productId: input.round.productId,
          nameSnapshot: input.productName,
          selections,
          size: selections['Хэмжээ'] ?? null,
          color: selections['Өнгө'] ?? null,
          qty: input.qty,
          unitPrice: input.round.sellPrice,
          costPriceSnapshot: input.round.costPrice,
        },
      },
    },
  });
  if (input.paid) {
    await prisma.payment.create({
      data: {
        orderId: order.id,
        kind: 'PAYMENT',
        amount: subtotal,
        method: 'QPAY',
        note: 'Лизинг демо бэлэн борлуулалт',
        actor: 'system:leasing-demo',
      },
    });
  }
  await prisma.$transaction((tx) => recalcOrderTotals(tx, order.id));
  return order;
}

async function main() {
  console.info('Лизинг демо өгөгдөл нэмэж байна (локал)…');
  console.info('Бааз:', process.env.DATABASE_URL);
  await wipePrevious();

  const leasing = await prisma.adminUser.findFirst({ where: { role: 'LEASING' } });
  if (!leasing) throw new Error('Лизингийн админ олдсонгүй. Эхлээд локал seed ажиллуулна уу.');

  const category = await prisma.category.findFirst({ where: { deletedAt: null, isActive: true } });
  if (!category) throw new Error('Ангилал олдсонгүй.');

  await prisma.setting.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      leasingBankName: 'Хаан банк',
      leasingBankAccountNumber: '5005987654',
      leasingBankAccountName: 'ИТГЭЛ ЛИЗИНГ',
      leasingPaymentNote: 'Гүйлгээний утгад захиалгын кодоо бичнэ үү. (лизинг демо)',
      leasingSmsDueToday:
        'ИтгэлШоп: Сайн байна уу, {ner}. Таны лизингийн эргэн төлөлтийн {dun}₮ өнөөдөр ({ognoo}) төлөгдөнө. (демо)',
      leasingSmsOverdue:
        'ИтгэлШоп: Сайн байна уу, {ner}. Таны лизингийн {dun}₮ төлбөр {honog} хоног хоцорсон байна. (демо)',
      leasingSmsArrivedUnpaid:
        'ИтгэлШоп: Сайн байна уу, {ner}. Бараа ирлээ. Үлдэгдэл {dun}₮-өө төлсний дараа авна. (демо)',
    },
    update: {
      leasingBankName: 'Хаан банк',
      leasingBankAccountNumber: '5005987654',
      leasingBankAccountName: 'ИТГЭЛ ЛИЗИНГ',
      leasingPaymentNote: 'Гүйлгээний утгад захиалгын кодоо бичнэ үү. (лизинг демо)',
      leasingSmsDueToday:
        'ИтгэлШоп: Сайн байна уу, {ner}. Таны лизингийн эргэн төлөлтийн {dun}₮ өнөөдөр ({ognoo}) төлөгдөнө. (демо)',
      leasingSmsOverdue:
        'ИтгэлШоп: Сайн байна уу, {ner}. Таны лизингийн {dun}₮ төлбөр {honog} хоног хоцорсон байна. (демо)',
      leasingSmsArrivedUnpaid:
        'ИтгэлШоп: Сайн байна уу, {ner}. Бараа ирлээ. Үлдэгдэл {dun}₮-өө төлсний дараа авна. (демо)',
    },
  });

  const settings = await prisma.setting.findUniqueOrThrow({ where: { id: 1 } });
  const tiers = parseLeasingFeeTiers(settings.leasingFeeTiers);

  const customers = await Promise.all(
    CUSTOMERS.map((c) =>
      prisma.customer.create({
        data: {
          ...c,
          phoneVerifiedAt: now,
          emailVerifiedAt: now,
          district: 'Сүхбаатар',
          khoroo: '1-р хороо',
          addressText: 'Лизинг демо хаяг',
        },
      }),
    ),
  );

  const source = await prisma.productRound.findFirst({
    where: { deletedAt: null, ownerKind: 'SHOP', product: { deletedAt: null } },
    include: { product: { include: { variants: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (!source) throw new Error('Дэлгүүрийн бараа олдсонгүй.');
  const sourceName = source.product.name;
  const size = source.product.variants.find((v) => v.kind === 'Хэмжээ')?.value;
  const color = source.product.variants.find((v) => v.kind === 'Өнгө')?.value;
  const selections: Record<string, string> = {};
  if (size) selections['Хэмжээ'] = size;
  if (color) selections['Өнгө'] = color;

  const warehouse = await prisma.batch.create({
    data: {
      name: `${DEMO_PREFIX}агуулах`,
      stage: 'AT_WAREHOUSE',
      closedAt: addDays(now, -10),
      etaFrom: addDays(now, -3),
      etaTo: addDays(now, -1),
    },
  });
  const transit = await prisma.batch.create({
    data: {
      name: `${DEMO_PREFIX}замд`,
      stage: 'IN_TRANSIT',
      closedAt: addDays(now, -4),
      etaFrom: addDays(now, 2),
      etaTo: addDays(now, 6),
    },
  });

  const feeOf = (qty: number) => leasingFeeOf(source.sellPrice * qty, tiers);
  const fullOf = (qty: number) => source.sellPrice * qty + feeOf(qty);

  const roundRef: RoundRef = {
    id: source.id,
    productId: source.productId,
    sellPrice: source.sellPrice,
    costPrice: source.costPrice,
    closeAt: source.closeAt,
    leadMinDays: source.leadMinDays,
    leadMaxDays: source.leadMaxDays,
  };

  const leasingOrder = (partial: {
    customerId: string;
    qty: number;
    status: OrderStatus;
    createdAt: Date;
    paid: number;
    batchId?: string | null;
    note: string;
  }) =>
    createLeasingOrder({
      ...partial,
      round: roundRef,
      productName: sourceName,
      selections,
      leasingFee: feeOf(partial.qty),
    });

  await leasingOrder({
    customerId: customers[0]!.id,
    qty: 1,
    status: 'CONFIRMED',
    createdAt: addDays(today, -2),
    paid: feeOf(1),
    note: 'Ирээгүй · шимтгэл төлсөн',
  });
  await leasingOrder({
    customerId: customers[1]!.id,
    qty: 1,
    status: 'IN_BATCH',
    createdAt: addDays(today, -8),
    paid: feeOf(1),
    batchId: transit.id,
    note: 'Багцад · ирээгүй',
  });
  await leasingOrder({
    customerId: customers[2]!.id,
    qty: 1,
    status: 'IN_TRANSIT',
    createdAt: addDays(today, -9),
    paid: feeOf(1),
    batchId: transit.id,
    note: 'Замд',
  });
  await leasingOrder({
    customerId: customers[3]!.id,
    qty: 1,
    status: 'ARRIVED',
    createdAt: addDays(today, -18),
    paid: feeOf(1),
    batchId: warehouse.id,
    note: 'Ирсэн · төлөөгүй',
  });
  await leasingOrder({
    customerId: customers[4]!.id,
    qty: 1,
    status: 'ARRIVED',
    createdAt: addDays(today, -20),
    paid: fullOf(1),
    batchId: warehouse.id,
    note: 'Ирсэн · төлсөн',
  });
  await leasingOrder({
    customerId: customers[5]!.id,
    qty: 1,
    status: 'HANDED_OVER',
    createdAt: addDays(today, -25),
    paid: fullOf(1),
    batchId: warehouse.id,
    note: 'Хүлээлгэсэн',
  });
  await leasingOrder({
    customerId: customers[6]!.id,
    qty: 1,
    status: 'CONFIRMED',
    createdAt: addDays(today, -5),
    paid: feeOf(1),
    note: 'Хуваарь өнөөдөр',
  });
  await leasingOrder({
    customerId: customers[7]!.id,
    qty: 1,
    status: 'ARRIVED',
    createdAt: addDays(today, -14),
    paid: feeOf(1),
    batchId: warehouse.id,
    note: 'Хуваарь хоцорсон',
  });

  const fullTransfer = await leasingOrder({
    customerId: customers[8]!.id,
    qty: 1,
    status: 'ARRIVED',
    createdAt: addDays(today, -16),
    paid: feeOf(1),
    batchId: warehouse.id,
    note: 'Бүгдийг бэлэн бараанд шилжүүлнэ',
  });
  const partial = await leasingOrder({
    customerId: customers[9]!.id,
    qty: 2,
    status: 'ARRIVED',
    createdAt: addDays(today, -11),
    paid: feeOf(2),
    batchId: warehouse.id,
    note: 'Хэсэгчлэн шилжүүлнэ',
  });

  const fullItem = fullTransfer.items.find((i) => !i.cancelledAt)!;
  const fullResult = await executeReadyTransfer({
    orderId: fullTransfer.id,
    ownerAdminId: leasing.id,
    reason: 'Төлөхгүй гэсэн тул бэлэн бараанд шилжүүлэв',
    lines: [{ orderItemId: fullItem.id, qty: 1, resaleUnitPrice: source.sellPrice }],
    actor: `admin:${leasing.id}`,
  });

  const partialItem = partial.items.find((i) => !i.cancelledAt)!;
  const partialResult = await executeReadyTransfer({
    orderId: partial.id,
    ownerAdminId: leasing.id,
    reason: 'Нэг ширхэгийг бэлэн бараанд шилжүүлэв',
    lines: [{ orderItemId: partialItem.id, qty: 1, resaleUnitPrice: source.sellPrice }],
    actor: `admin:${leasing.id}`,
  });

  const destRounds = await prisma.productRound.findMany({
    where: { id: { in: [...fullResult.destRoundIds, ...partialResult.destRoundIds] } },
    select: { productId: true },
  });
  for (const row of destRounds) {
    await prisma.product.update({
      where: { id: row.productId },
      data: { name: `${DEMO_PREFIX}шилжүүлсэн ${sourceName}` },
    });
  }

  const active = await createReadyProduct({
    adminId: leasing.id,
    categoryId: category.id,
    name: 'Куртка',
    status: 'ACTIVE',
    sellPrice: 189_000,
    options: [
      { name: 'Хэмжээ', values: ['M', 'L'] },
      { name: 'Өнгө', values: ['Хар', 'Цагаан'] },
    ],
    stock: 8,
  });
  await createReadyProduct({
    adminId: leasing.id,
    categoryId: category.id,
    name: 'Нуусан цамц',
    status: 'HIDDEN',
    sellPrice: 49_000,
    options: [{ name: 'Хэмжээ', values: ['M', 'L'] }],
    stock: 4,
  });
  await createReadyProduct({
    adminId: leasing.id,
    categoryId: category.id,
    name: 'Ноорог гутал',
    status: 'DRAFT',
    sellPrice: 129_000,
    stock: 2,
  });
  await createReadyProduct({
    adminId: leasing.id,
    categoryId: category.id,
    name: 'Дууссан цүнх',
    status: 'SOLD_OUT',
    sellPrice: 79_000,
    stock: 0,
  });

  await createResaleOrder({
    customerId: customers[0]!.id,
    round: active.round,
    productName: active.product.name,
    selections: { Хэмжээ: 'M', Өнгө: 'Хар' },
    qty: 1,
    paid: false,
  });
  await createResaleOrder({
    customerId: customers[1]!.id,
    round: active.round,
    productName: active.product.name,
    selections: { Хэмжээ: 'L', Өнгө: 'Цагаан' },
    qty: 1,
    paid: true,
  });

  const counts = await prisma.order.groupBy({
    by: ['isLeasing', 'payeeKind', 'status'],
    where: { customerId: { in: customers.map((c) => c.id) } },
    _count: true,
  });
  console.info('Захиалга:', counts);
  console.info('Бэлэн бараа: идэвхтэй / нуусан / ноорог / дууссан + шилжүүлсэн');
  console.info('Хэрэглэгч: 10');
  console.info('Лизинг нэвтрэлт: leasing@itgel.mn / leasing123');
}

await main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
