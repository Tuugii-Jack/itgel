/**
 * Ярилцлага/демод зориулсан цэвэр өгөгдөл.
 * — ≤5 бараа (бодит Unsplash зураг)
 * — ≤10 захиалга
 * — бодит монгол нэр, утас, gmail
 *
 * Usage: npx tsx scripts/seed-demo.ts --force
 */
import { PrismaClient, type OrderStatus, type Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import 'dotenv/config';
import { generateOrderCode } from '../src/lib/code.js';
import { addDays, startOfUbDay } from '../src/lib/date.js';
import { subtotalOf } from '../src/lib/money.js';
import { attachOrdersForRound } from '../src/services/batches.js';
import { DEFAULT_DELIVERY_FEES } from '../src/services/settings.js';

const prisma = new PrismaClient();
const now = new Date();

function assertSafeToWipe() {
  const forced = process.argv.includes('--force') || process.env.SEED_ALLOW_DESTRUCTIVE === '1';
  if (forced) return;

  const url = process.env.DATABASE_URL ?? '';
  const remote = !/localhost|127\.0\.0\.1/.test(url);
  if (remote || process.env.NODE_ENV === 'production') {
    console.error(
      '\nSeed зогслоо — бүх өгөгдлийг устгана.\n' +
        'Үнэхээр устгах бол: npx tsx scripts/seed-demo.ts --force\n',
    );
    process.exit(1);
  }
}

async function reset() {
  await prisma.auditLog.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.sizeChartRow.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.productRound.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.ad.deleteMany();
  await prisma.emailOtp.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.adminUser.deleteMany();
  await prisma.setting.deleteMany();
}

/** Бодит зураг — Unsplash (дотоод storage шаардлагагүй). Бараа бүр 2–3 зураг. */
const IMG = {
  skincare:
    'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?auto=format&fit=crop&w=1000&h=1000&q=80',
  skincare2:
    'https://images.unsplash.com/photo-1571781926291-c77df809125b?auto=format&fit=crop&w=1000&h=1000&q=80',
  skincare3:
    'https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?auto=format&fit=crop&w=1000&h=1000&q=80',
  jacket:
    'https://images.unsplash.com/photo-1544923246-77307dd628ce?auto=format&fit=crop&w=1000&h=1000&q=80',
  jacket2:
    'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1000&h=1000&q=80',
  jacket3:
    'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?auto=format&fit=crop&w=1000&h=1000&q=80',
  earbuds:
    'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&w=1000&h=1000&q=80',
  earbuds2:
    'https://images.unsplash.com/photo-1606220945770-b5b6c2c55bf1?auto=format&fit=crop&w=1000&h=1000&q=80',
  earbuds3:
    'https://images.unsplash.com/photo-1484704849700-f032a568e944?auto=format&fit=crop&w=1000&h=1000&q=80',
  cream:
    'https://images.unsplash.com/photo-1620916567646-7bae0f8c8f0b?auto=format&fit=crop&w=1000&h=1000&q=80',
  cream2:
    'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=1000&h=1000&q=80',
  cream3:
    'https://images.unsplash.com/photo-1570194065650-d99fb4b38b15?auto=format&fit=crop&w=1000&h=1000&q=80',
  tee: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1000&h=1000&q=80',
  tee2: 'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?auto=format&fit=crop&w=1000&h=1000&q=80',
  tee3: 'https://images.unsplash.com/photo-1562157873-818bc0726f68?auto=format&fit=crop&w=1000&h=1000&q=80',
  banner:
    'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1600&h=600&q=80',
};

interface OptionGroup {
  kind: string;
  values: string[];
}

interface ProductSeed {
  name: string;
  description: string;
  category: string;
  images: string[];
  costPrice: number;
  sellPrice: number;
  stock: number;
  closeInDays: number | null;
  /** Админ «Сонголт» хэсэгт харагдах төрлүүд — бараа бүрд 2–3 төрөл. */
  options: OptionGroup[];
}

const PRODUCTS: ProductSeed[] = [
  {
    name: 'Солонгос гоо сайхны багц',
    description:
      'Арьс арчилгааны 4 бүтээгдэхүүнтэй иж бүрдэл. Хуурайшилттай арьсанд тохиромжтой. Солонгосоос захиалгаар авчирна.',
    category: 'Гоо сайхан',
    images: [IMG.skincare, IMG.skincare2, IMG.skincare3],
    costPrice: 42_000,
    sellPrice: 79_000,
    stock: 0,
    closeInDays: 5,
    options: [
      { kind: 'Өнгө', values: ['Ягаан', 'Цагаан', 'Ногоон'] },
      { kind: 'Багтаамж', values: ['30ml', '50ml', '100ml'] },
      { kind: 'Амт', values: ['Чихэр өвс', 'Чай цай', 'Үнэргүй'] },
    ],
  },
  {
    name: 'Өвлийн ноосон куртка',
    description:
      'Дулаан, хөнгөн ноосон куртка. Өдөр тутмын өмсөлтөд тохиромжтой. Хэмжээ сонгоод захиална уу.',
    category: 'Хувцас',
    images: [IMG.jacket, IMG.jacket2, IMG.jacket3],
    costPrice: 120_000,
    sellPrice: 199_000,
    stock: 0,
    closeInDays: 8,
    options: [
      { kind: 'Хэмжээ', values: ['S', 'M', 'L', 'XL'] },
      { kind: 'Өнгө', values: ['Хар', 'Бэж', 'Хөх', 'Саарал'] },
      { kind: 'Материал', values: ['Ноос', 'Полиэстер', 'Холимог'] },
    ],
  },
  {
    name: 'Утасгүй чихэвч',
    description:
      'Дууны чанар сайтай, цэнэг удаан барьдаг утасгүй чихэвч. Цэнэглэгч хайрцагтай.',
    category: 'Электроник',
    images: [IMG.earbuds, IMG.earbuds2, IMG.earbuds3],
    costPrice: 78_000,
    sellPrice: 139_000,
    stock: 0,
    closeInDays: 3,
    options: [
      { kind: 'Өнгө', values: ['Хар', 'Цагаан', 'Цэнхэр'] },
      { kind: 'Загвар', values: ['In-ear', 'Sport', 'Pro'] },
      { kind: 'Багтаамж', values: ['Standart', '+кейс', '+кабель'] },
    ],
  },
  {
    name: 'Нүүрний чийгшүүлэгч тос',
    description:
      'Агуулахад бэлэн. Мэдрэмтгий арьсанд ээлтэй. Шууд авах боломжтой.',
    category: 'Гоо сайхан',
    images: [IMG.cream, IMG.cream2, IMG.cream3],
    costPrice: 18_000,
    sellPrice: 35_000,
    stock: 14,
    closeInDays: null,
    options: [
      { kind: 'Багтаамж', values: ['30ml', '50ml', '100ml'] },
      { kind: 'Амт', values: ['Цэцэг', 'Ногоон цай', 'Үнэргүй'] },
      { kind: 'Загвар', values: ['Хуурай арьс', 'Тослог арьс', 'Холимог'] },
    ],
  },
  {
    name: 'Оверсайз цамц',
    description:
      '100% хөвөн, зөөлөн материал. Агуулахаас шууд авна. Хэмжээ, өнгө, материал сонгоно уу.',
    category: 'Хувцас',
    images: [IMG.tee, IMG.tee2, IMG.tee3],
    costPrice: 28_000,
    sellPrice: 49_000,
    stock: 22,
    closeInDays: null,
    options: [
      { kind: 'Хэмжээ', values: ['M', 'L', 'XL'] },
      { kind: 'Өнгө', values: ['Хар', 'Цагаан', 'Саарал'] },
      { kind: 'Материал', values: ['Хөвөн', 'Органик хөвөн', 'Холимог'] },
    ],
  },
];
const CUSTOMERS = [
  {
    phone: '99112233',
    name: 'Батбаярын Оюунчимэг',
    email: 'oyun.batbayar@gmail.com',
    district: 'Сүхбаатар',
    khoroo: '5-р хороо',
    addressText: 'Их сургуулийн гудамж 12, 3 давхар 12 тоот',
  },
  {
    phone: '88445566',
    name: 'Доржийн Ганбат',
    email: 'ganbat.dorj@gmail.com',
    district: 'Баянзүрх',
    khoroo: '15-р хороо',
    addressText: '13-р хороолол, 45-р байр, 8 тоот',
  },
  {
    phone: '95778899',
    name: 'Сэргэлэнгийн Ариунаа',
    email: 'ariunaa.sergelen@gmail.com',
    district: 'Хан-Уул',
    khoroo: '3-р хороо',
    addressText: 'Зайсан толгой орчим, 22-р байр',
  },
  {
    phone: '91223344',
    name: 'Төмөрийн Мөнхбат',
    email: 'munkhbat.temur@gmail.com',
    district: 'Баянгол',
    khoroo: '10-р хороо',
    addressText: '1-р хороолол, 7-р байр, 21 тоот',
  },
  {
    phone: '80556677',
    name: 'Цэрэнгийн Номин',
    email: 'nomin.tseveen@gmail.com',
    district: 'Чингэлтэй',
    khoroo: '4-р хороо',
    addressText: 'Жуулчны гудамж 8',
  },
];

async function main() {
  assertSafeToWipe();
  console.info('Демо seed эхэлж байна — бүх өгөгдлийг цэвэрлэнэ…');
  await reset();

  await prisma.setting.create({
    data: {
      id: 1,
      storeName: 'itgel',
      phone: '85001068',
      address: 'СБД, 1-р хороо, Их сургуулийн гудамж 12, "Итгэл" төв, 2 давхар 205 тоот',
      workHours: 'Даваа–Бямба 10:00–19:00',
      facebookUrl: 'https://facebook.com/itgel.mn',
      defaultLeadMinDays: 7,
      defaultLeadMaxDays: 14,
      smsOnArrival: false,
      autoCloseOnDeadline: true,
      deliveryFees: DEFAULT_DELIVERY_FEES,
      deliveryDailyLimit: 20,
      bankName: 'Хаан банк',
      bankAccountNumber: '5005123456',
      bankAccountName: 'ИТГЭЛ ХХК',
      paymentNote: 'Гүйлгээний утгад захиалгын кодоо бичнэ үү.',
      storageFreeDays: 7,
      storageFeePerDay: 1000,
    },
  });

  const adminEmail = (process.env.ADMIN_EMAIL ?? 'admin@itgel.mn').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'admin123';
  await prisma.adminUser.create({
    data: {
      email: adminEmail,
      name: 'Болдбаатар Админ',
      passwordHash: await bcrypt.hash(adminPassword, 10),
      role: 'ADMIN',
    },
  });

  await prisma.ad.create({
    data: {
      title: 'Шинэ захиалгын бараа',
      imageUrl: IMG.banner,
      linkUrl: '/order',
      sortOrder: 0,
      isActive: true,
    },
  });

  const categoryNames = [...new Set(PRODUCTS.map((p) => p.category))];
  const categories = await Promise.all(
    categoryNames.map((name, i) =>
      prisma.category.create({ data: { name, sortOrder: i, isActive: true } }),
    ),
  );
  const categoryByName = new Map(categories.map((c) => [c.name, c]));

  const products: Prisma.ProductGetPayload<{
    include: { variants: true; rounds: true };
  }>[] = [];

  for (const seed of PRODUCTS) {
    const category = categoryByName.get(seed.category)!;
    const sizes = seed.options.find((o) => o.kind === 'Хэмжээ')?.values ?? [];
    const variantRows = seed.options.flatMap((group, groupIndex) =>
      group.values.map((value, i) => ({
        kind: group.kind,
        value,
        sortOrder: groupIndex * 100 + i,
      })),
    );
    const product = await prisma.product.create({
      data: {
        name: seed.name,
        description: seed.description,
        categoryId: category.id,
        images: seed.images,
        variants: { create: variantRows },
        sizeChart: {
          create: sizes.map((size, i) => ({
            size,
            heightRange: `${155 + i * 5}–${165 + i * 5} см`,
            chestCm: `${86 + i * 6}–${92 + i * 6} см`,
            sortOrder: i,
          })),
        },
        rounds: {
          create: {
            roundNo: 1,
            costPrice: seed.costPrice,
            sellPrice: seed.sellPrice,
            stock: seed.stock,
            closeAt:
              seed.closeInDays === null ? null : startOfUbDay(addDays(now, seed.closeInDays)),
            leadMinDays: 7,
            leadMaxDays: 14,
            status: 'ACTIVE',
          },
        },
      },
      include: { variants: true, rounds: true },
    });
    products.push(product);
  }

  const passwordHash = await bcrypt.hash('demo1234', 10);
  const customers = await Promise.all(
    CUSTOMERS.map((c) =>
      prisma.customer.create({
        data: {
          email: c.email,
          phone: c.phone,
          name: c.name,
          emailVerifiedAt: now,
          passwordHash,
          district: c.district,
          khoroo: c.khoroo,
          addressText: c.addressText,
          notifyPayment: true,
          notifyArrival: true,
        },
      }),
    ),
  );

  const batches = await Promise.all([
    prisma.batch.create({
      data: {
        name: 'Хаврын багц — цуглуулж байна',
        stage: 'COLLECTING',
        deadline: startOfUbDay(addDays(now, 8)),
      },
    }),
    prisma.batch.create({
      data: {
        name: 'Өвлийн багц — зам дээр',
        stage: 'IN_TRANSIT',
        closedAt: addDays(now, -10),
        weightKg: 42,
        etaFrom: addDays(now, 2),
        etaTo: addDays(now, 6),
      },
    }),
  ]);

  // Захиалгын бараануудыг цуглуулж буй багцтай холбоно.
  for (const p of products) {
    const round = p.rounds[0]!;
    if (round.closeAt) {
      await prisma.productRound.update({
        where: { id: round.id },
        data: { batchId: batches[0]!.id },
      });
      round.batchId = batches[0]!.id;
    }
  }

  // ≤10 захиалга — төлөв бүрээс жишээ.
  // Урьдчилсан бараа (0,1,2) → цуглуулж буй багц; бэлэн (3,4) → багцгүй.
  type Plan = {
    customer: number;
    items: [number, number][];
    status: OrderStatus;
    /** null = автоматаар урьдчилсан барааны багц / бэлэн бол null */
    batch: number | null | 'auto';
    daysAgo: number;
    /** true бол төлбөр дутуу үлдээнэ (багцаас хасах демо). */
    unpaid?: boolean;
  };

  const plan: Plan[] = [
    { customer: 0, items: [[0, 1]], status: 'NEW', batch: null, daysAgo: 0 },
    { customer: 1, items: [[3, 2]], status: 'CONFIRMED', batch: null, daysAgo: 1 },
    { customer: 2, items: [[1, 1]], status: 'IN_BATCH', batch: 'auto', daysAgo: 3 },
    { customer: 3, items: [[2, 1]], status: 'IN_BATCH', batch: 'auto', daysAgo: 4, unpaid: true },
    { customer: 4, items: [[1, 1]], status: 'IN_BATCH', batch: 'auto', daysAgo: 5 },
    { customer: 0, items: [[3, 1]], status: 'ARRIVED', batch: null, daysAgo: 5 },
    { customer: 1, items: [[4, 2]], status: 'ARRIVED', batch: null, daysAgo: 6 },
    { customer: 2, items: [[0, 1]], status: 'IN_BATCH', batch: 'auto', daysAgo: 2 },
  ];

  const orderCodes: string[] = [];

  for (const [index, entry] of plan.entries()) {
    const items = entry.items.map(([productIndex, qty]) => {
      const product = products[productIndex]!;
      const round = product.rounds[0]!;
      const kinds = [...new Set(product.variants.map((v) => v.kind))];
      const selections: Record<string, string> = {};
      for (const kind of kinds) {
        const values = product.variants.filter((v) => v.kind === kind);
        const picked = values[index % values.length];
        if (picked) selections[kind] = picked.value;
      }
      const size = selections['Хэмжээ'] ?? null;
      const color = selections['Өнгө'] ?? null;
      return {
        roundId: round.id,
        productId: product.id,
        nameSnapshot: product.name,
        selections,
        size,
        color,
        qty,
        unitPrice: round.sellPrice,
        costPriceSnapshot: round.costPrice,
        arriveFrom: round.closeAt === null ? null : addDays(round.closeAt, round.leadMinDays),
        arriveTo: round.closeAt === null ? null : addDays(round.closeAt, round.leadMaxDays),
      };
    });

    const subtotal = subtotalOf(items);
    const paid = entry.status === 'NEW' || entry.unpaid ? 0 : subtotal;
    const code = generateOrderCode();
    orderCodes.push(code);

    const batchId =
      entry.batch === 'auto'
        ? batches[0]!.id
        : entry.batch === null
          ? null
          : batches[entry.batch]!.id;

    await createOrder({
      code,
      customerId: customers[entry.customer]!.id,
      status: entry.status,
      subtotal,
      paidAmount: paid,
      batchId,
      createdAt: addDays(now, -entry.daysAgo),
      items,
    });
  }

  // batchId-гүй ч тойрогт захиалсан захиалгуудыг хавсаргана (NEW-ээс бусад).
  await prisma.$transaction(async (tx) => {
    for (const p of products) {
      const round = p.rounds[0]!;
      if (round.batchId) await attachOrdersForRound(tx, round.id, round.batchId);
    }
  });

  // Зам дээрх багцын жишээ — цуглуулсан багцын нэгийг ахиулсан мэт тусдаа багц.
  // (Демод 2 багц харагдахын тулд хоосон биш — жин/ETA-тай.)
  await prisma.batch.update({
    where: { id: batches[1]!.id },
    data: {
      name: 'Өвлийн багц — зам дээр',
      stage: 'IN_TRANSIT',
    },
  });

  // Ирсэн захиалгын нэгийг хүргэлттэй болгоно.
  const arrived = await prisma.order.findFirst({
    where: { status: 'ARRIVED', deletedAt: null },
    include: { customer: true },
    orderBy: { createdAt: 'desc' },
  });
  if (arrived) {
    await prisma.order.update({
      where: { id: arrived.id },
      data: {
        fulfilment: 'DELIVERY',
        deliveryFee: 6000,
        dueAmount: arrived.dueAmount + 6000,
      },
    });
    await prisma.delivery.create({
      data: {
        orderId: arrived.id,
        scheduledDay: startOfUbDay(addDays(now, 1)),
        district: arrived.customer.district ?? 'Баянзүрх',
        khoroo: arrived.customer.khoroo ?? '1-р хороо',
        addressText: arrived.customer.addressText ?? 'Дэлгүүрт ойр',
        fee: 6000,
        courierName: 'Батжаргалын Тэмүүлэн',
        status: 'ASSIGNED',
      },
    });
  }

  // ARRIVED бэлэн барааны мөрүүдэд arrivedAt
  const arrivedOrders = await prisma.order.findMany({
    where: { status: { in: ['ARRIVED', 'HANDED_OVER'] }, deletedAt: null },
  });
  for (const o of arrivedOrders) {
    const at = o.arrivedAt ?? addDays(o.createdAt, 4);
    await prisma.orderItem.updateMany({
      where: { orderId: o.id, cancelledAt: null },
      data: {
        arrivedAt: at,
        handedOverAt: o.status === 'HANDED_OVER' ? (o.handedOverAt ?? addDays(at, 1)) : null,
      },
    });
  }

  console.info('');
  console.info('=== Демо өгөгдөл бэлэн ===');
  console.info(`Бараа:      ${products.length}`);
  console.info(`Хэрэглэгч:  ${customers.length}`);
  console.info(`Захиалга:   ${plan.length}`);
  console.info(`Багц:       ${batches.length}`);
  console.info('');
  console.info('Админ нэвтрэх:');
  console.info(`  ${adminEmail} / ${adminPassword}`);
  console.info('');
  console.info('Хэрэглэгч нэвтрэх (бүгд ижил нууц үг):');
  console.info(`  ${CUSTOMERS[0]!.email} / demo1234`);
  console.info(`  утас жишээ: ${CUSTOMERS[0]!.phone}`);
  console.info('');
  console.info('Захиалгын код:');
  for (const code of orderCodes) console.info(`  ${code}`);
  console.info('');
  console.info('SHOP:  http://localhost:3000/');
  console.info('ADMIN: http://localhost:3000/admin');
}

interface SeedOrder {
  code: string;
  customerId: string;
  status: OrderStatus;
  subtotal: number;
  paidAmount: number;
  batchId: string | null;
  createdAt: Date;
  items: Prisma.OrderItemUncheckedCreateWithoutOrderInput[];
}

async function createOrder(order: SeedOrder) {
  const flow: OrderStatus[] = [
    'NEW',
    'CONFIRMED',
    'IN_BATCH',
    'IN_TRANSIT',
    'ARRIVED',
    'HANDED_OVER',
  ];
  const reached = (status: OrderStatus) =>
    order.status !== 'CANCELLED' && flow.indexOf(order.status) >= flow.indexOf(status);

  const at = (days: number) => addDays(order.createdAt, days);

  const created = await prisma.order.create({
    data: {
      code: order.code,
      customerId: order.customerId,
      status: order.status,
      subtotal: order.subtotal,
      paidAmount: order.paidAmount,
      refundedAmount: 0,
      dueAmount: order.subtotal - order.paidAmount,
      batchId: order.batchId,
      createdAt: order.createdAt,
      confirmedAt: reached('CONFIRMED') ? at(1) : null,
      inBatchAt: reached('IN_BATCH') ? at(2) : null,
      inTransitAt: reached('IN_TRANSIT') ? at(5) : null,
      arrivedAt: reached('ARRIVED') ? at(8) : null,
      arrivalNotifiedAt: reached('ARRIVED') ? at(8) : null,
      handedOverAt: reached('HANDED_OVER') ? at(10) : null,
      cancelledAt: order.status === 'CANCELLED' ? at(1) : null,
      fulfilment: order.status === 'ARRIVED' || order.status === 'HANDED_OVER' ? 'PICKUP' : null,
      items: { create: order.items },
    },
  });

  if (order.paidAmount > 0) {
    await prisma.payment.create({
      data: {
        orderId: created.id,
        kind: 'PAYMENT',
        amount: order.paidAmount,
        method: 'BANK_TRANSFER',
        note: 'Дансаар шилжүүлсэн',
        actor: 'system',
        createdAt: addDays(order.createdAt, 1),
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
