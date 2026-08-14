/**
 * Seed — 6 ангилал, 10 бараа, 9 захиалга, 3 багц, 7 хэрэглэгч, 6 сарын борлуулалт.
 * Дахин ажиллуулахад өгөгдлийг цэвэрлээд шинээр үүсгэнэ.
 */
import { PrismaClient, type OrderStatus, type Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import 'dotenv/config';
import { generateOrderCode } from '../src/lib/code.js';
import { addDays, addUbMonths, startOfUbDay, startOfUbMonth } from '../src/lib/date.js';
import { subtotalOf } from '../src/lib/money.js';
import { DEFAULT_DELIVERY_FEES } from '../src/services/settings.js';

const prisma = new PrismaClient();
const now = new Date();

/**
 * Seed нь БҮХ өгөгдлийг устгадаг. Production бааз руу санамсаргүй
 * ажиллуулахаас сэргийлнэ — `--force` эсвэл SEED_ALLOW_DESTRUCTIVE=1 хэрэгтэй.
 */
function assertSafeToWipe() {
  const forced = process.argv.includes('--force') || process.env.SEED_ALLOW_DESTRUCTIVE === '1';
  if (forced) return;

  const url = process.env.DATABASE_URL ?? '';
  const remote = !/localhost|127\.0\.0\.1/.test(url);
  const prod = process.env.NODE_ENV === 'production';

  if (prod || remote) {
    console.error(
      '\nSeed зогслоо — энэ нь бүх өгөгдлийг устгана.\n' +
        `  NODE_ENV : ${process.env.NODE_ENV ?? '(тодорхойгүй)'}\n` +
        `  Бааз     : ${remote ? 'алсын сервер' : 'локал'}\n\n` +
        'Үнэхээр устгах бол: npm run seed -- --force\n',
    );
    process.exit(1);
  }
}

async function reset() {
  await prisma.auditLog.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.sizeChartRow.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.ad.deleteMany();
  await prisma.emailOtp.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.adminUser.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.setting.deleteMany();
}

const CATEGORIES = [
  'Гоо сайхан',
  'Хувцас',
  'Гэр ахуй',
  'Электроник',
  'Хүүхдийн бараа',
  'Спорт',
];

const SIZES = ['S', 'M', 'L', 'XL'];
const COLORS = ['Хар', 'Цагаан', 'Бэж', 'Хөх'];

interface ProductSeed {
  name: string;
  category: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  /** Хэдэн хоногийн дараа захиалга хаагдах — null бол бэлэн бараа. */
  closeInDays: number | null;
  status?: 'ACTIVE' | 'CLOSED' | 'SOLD_OUT' | 'DRAFT' | 'HIDDEN';
  sizes?: string[];
  colors?: string[];
}

const PRODUCTS: ProductSeed[] = [
  { name: 'Солонгос гоо сайхны багц', category: 'Гоо сайхан', costPrice: 42_000, sellPrice: 79_000, stock: 0, closeInDays: 6, colors: ['Ягаан'] },
  { name: 'Нүүрний чийгшүүлэгч тос', category: 'Гоо сайхан', costPrice: 18_000, sellPrice: 35_000, stock: 12, closeInDays: null },
  { name: 'Өвлийн ноосон куртка', category: 'Хувцас', costPrice: 120_000, sellPrice: 199_000, stock: 0, closeInDays: 9, sizes: SIZES, colors: COLORS },
  { name: 'Оверсайз цамц', category: 'Хувцас', costPrice: 28_000, sellPrice: 49_000, stock: 24, closeInDays: null, sizes: ['M', 'L', 'XL'], colors: ['Хар', 'Цагаан'] },
  { name: 'Гал тогооны хутганы иж бүрдэл', category: 'Гэр ахуй', costPrice: 65_000, sellPrice: 115_000, stock: 0, closeInDays: 12 },
  { name: 'Агаар цэвэршүүлэгч', category: 'Гэр ахуй', costPrice: 210_000, sellPrice: 349_000, stock: 3, closeInDays: null },
  { name: 'Утасгүй чихэвч', category: 'Электроник', costPrice: 78_000, sellPrice: 139_000, stock: 0, closeInDays: 4 },
  { name: 'Зөөврийн цэнэглэгч 20000mAh', category: 'Электроник', costPrice: 45_000, sellPrice: 82_000, stock: 0, closeInDays: null, status: 'SOLD_OUT' },
  { name: 'Хүүхдийн боловсролын тоглоом', category: 'Хүүхдийн бараа', costPrice: 32_000, sellPrice: 62_000, stock: 8, closeInDays: null },
  { name: 'Иогийн дэвсгэр', category: 'Спорт', costPrice: 26_000, sellPrice: 55_000, stock: 0, closeInDays: -3, status: 'CLOSED' },
];

const CUSTOMERS = [
  { phone: '99112233', name: 'Б. Оюунчимэг', email: 'oyunaa@example.com' },
  { phone: '88445566', name: 'Д. Ганбат', email: 'ganbat@example.com' },
  { phone: '95778899', name: 'С. Ариунаа', email: 'ariunaa@example.com' },
  { phone: '91223344', name: 'Т. Мөнхбат', email: 'munkhbat@example.com' },
  { phone: '80556677', name: 'Ц. Номин', email: 'nomin@example.com' },
  { phone: '94667788', name: 'Э. Батжаргал', email: 'batjargal@example.com' },
  { phone: '85990011', name: 'Г. Сарантуяа', email: 'sarantuya@example.com' },
];

async function main() {
  assertSafeToWipe();
  console.info('Seed эхэлж байна…');
  await reset();

  const settings = await prisma.setting.create({
    data: {
      id: 1,
      storeName: 'itgel',
      phone: '7700-1234',
      address: 'СБД, 1-р хороо, Их сургуулийн гудамж 12, "Итгэл" төв, 2 давхар 205 тоот',
      workHours: 'Даваа–Бямба 10:00–19:00',
      facebookUrl: 'https://facebook.com/itgel.mn',
      defaultLeadMinDays: 7,
      defaultLeadMaxDays: 14,
      smsOnArrival: true,
      autoCloseOnDeadline: true,
      deliveryFees: DEFAULT_DELIVERY_FEES,
      deliveryDailyLimit: 20,
      bankName: 'Хаан банк',
      bankAccountNumber: '5005123456',
      bankAccountName: 'ИТГЭЛ ХХК',
      paymentNote: 'Гүйлгээний утгад захиалгын кодоо бичнэ үү.',
    },
  });

  await prisma.adminUser.create({
    data: {
      email: (process.env.ADMIN_EMAIL ?? 'admin@itgel.mn').toLowerCase(),
      name: 'Админ',
      passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD ?? 'admin123', 10),
      role: 'ADMIN',
    },
  });

  await prisma.ad.createMany({
    data: [
      {
        title: 'Захиалгын бараа',
        imageUrl: 'https://placehold.co/1200x400/1C1917/FFFFFF?text=Захиалгын+бараа',
        linkUrl: '/#order',
        sortOrder: 0,
      },
      {
        title: 'Бэлэн бараа',
        imageUrl: 'https://placehold.co/1200x400/57534E/FFFFFF?text=Бэлэн+бараа',
        linkUrl: '/#ready',
        sortOrder: 1,
      },
    ],
  });

  const categories = await Promise.all(
    CATEGORIES.map((name, i) =>
      prisma.category.create({ data: { name, sortOrder: i, isActive: true } }),
    ),
  );
  const categoryByName = new Map(categories.map((c) => [c.name, c]));

  // Бараа бүрд нэг тойрог. Дэлгүүрт захиалагдах нэгж нь ТОЙРОГ.
  const products: Prisma.ProductGetPayload<{
    include: { variants: true; rounds: true };
  }>[] = [];
  for (const seed of PRODUCTS) {
    const category = categoryByName.get(seed.category)!;
    const product = await prisma.product.create({
      data: {
        name: seed.name,
        description: `${seed.name} — гадаадаас захиалгаар авчирна. Чанарын баталгаатай.`,
        categoryId: category.id,
        images: [`https://placehold.co/800x800?text=${encodeURIComponent(seed.name)}`],
        variants: {
          create: [
            ...(seed.sizes ?? []).map((value, i) => ({ kind: 'Хэмжээ', value, sortOrder: i })),
            ...(seed.colors ?? []).map((value, i) => ({
              kind: 'Өнгө',
              value,
              sortOrder: 100 + i,
            })),
          ],
        },
        sizeChart: {
          create: (seed.sizes ?? []).map((size, i) => ({
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
            closeAt: seed.closeInDays === null ? null : startOfUbDay(addDays(now, seed.closeInDays)),
            leadMinDays: settings.defaultLeadMinDays,
            leadMaxDays: settings.defaultLeadMaxDays,
            status: seed.status ?? 'ACTIVE',
          },
        },
      },
      include: { variants: true, rounds: true },
    });
    products.push(product);
  }

  const customers = await Promise.all(
    CUSTOMERS.map((c) =>
      prisma.customer.create({
        data: {
          ...c,
          emailVerifiedAt: new Date(),
          passwordHash: null,
        },
      }),
    ),
  );

  const batches = await Promise.all([
    prisma.batch.create({
      data: {
        name: '2-р багц — 11 сар',
        stage: 'AT_WAREHOUSE',
        closedAt: addDays(now, -18),
        weightKg: 148,
        etaFrom: addDays(now, -4),
        etaTo: addDays(now, -1),
      },
    }),
    prisma.batch.create({
      data: {
        name: '3-р багц — 12 сар',
        stage: 'IN_TRANSIT',
        closedAt: addDays(now, -7),
        weightKg: 96,
        etaFrom: addDays(now, 3),
        etaTo: addDays(now, 8),
      },
    }),
    prisma.batch.create({
      data: { name: '4-р багц — цуглуулж байна', stage: 'COLLECTING', weightKg: null },
    }),
  ]);

  // --- Одоогийн 9 захиалга: төлөв бүрээр тарааж, дизайны бүх дэлгэцийг харуулна ---
  const plan: { customer: number; items: [number, number][]; status: OrderStatus; batch: number | null }[] = [
    { customer: 0, items: [[0, 1], [1, 2]], status: 'NEW', batch: null },
    { customer: 1, items: [[2, 1]], status: 'CONFIRMED', batch: null },
    { customer: 2, items: [[4, 1], [6, 1]], status: 'IN_BATCH', batch: 2 },
    { customer: 3, items: [[6, 2]], status: 'IN_TRANSIT', batch: 1 },
    { customer: 4, items: [[2, 1], [3, 1]], status: 'IN_TRANSIT', batch: 1 },
    { customer: 5, items: [[8, 1]], status: 'ARRIVED', batch: 0 },
    { customer: 6, items: [[5, 1]], status: 'ARRIVED', batch: 0 },
    { customer: 0, items: [[3, 2]], status: 'HANDED_OVER', batch: 0 },
    { customer: 1, items: [[9, 1]], status: 'CANCELLED', batch: null },
  ];

  for (const [index, entry] of plan.entries()) {
    const items = entry.items.map(([productIndex, qty]) => {
      const product = products[productIndex]!;
      const sizes = product.variants.filter((v) => v.kind === 'Хэмжээ' || v.kind === 'SIZE');
      const colors = product.variants.filter((v) => v.kind === 'Өнгө' || v.kind === 'COLOR');
      const round = product.rounds[0]!;
      const size = sizes[index % Math.max(1, sizes.length)]?.value ?? null;
      const color = colors[index % Math.max(1, colors.length)]?.value ?? null;
      const selections: Record<string, string> = {};
      if (size) selections['Хэмжээ'] = size;
      if (color) selections['Өнгө'] = color;
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
    const createdAt = addDays(now, -(20 - index));
    // Шинэ захиалгад мөнгө хараахан ороогүй, бусад нь бүтнээр төлөгдсөн.
    const paid = entry.status === 'NEW' || entry.status === 'CANCELLED' ? 0 : subtotal;

    await createOrder({
      code: generateOrderCode(),
      customerId: customers[entry.customer]!.id,
      status: entry.status,
      subtotal,
      paidAmount: paid,
      batchId: entry.batch === null ? null : batches[entry.batch]!.id,
      createdAt,
      items,
    });
  }

  // Хүргэлт — ирсэн захиалгуудын нэг нь хүргэлтээр
  const arrived = await prisma.order.findFirst({ where: { status: 'ARRIVED' } });
  if (arrived) {
    await prisma.order.update({
      where: { id: arrived.id },
      data: { fulfilment: 'DELIVERY', deliveryFee: 0, dueAmount: arrived.dueAmount },
    });
    await prisma.delivery.create({
      data: {
        orderId: arrived.id,
        scheduledDay: startOfUbDay(addDays(now, 1)),
        district: 'Баянзүрх',
        khoroo: '15-р хороо',
        addressText: '13-р хороолол, 45-р байр, 12 тоот',
        fee: 0,
        courierName: 'Б. Тэмүүлэн',
        status: 'ASSIGNED',
      },
    });
  }

  // --- 6 сарын түүхэн борлуулалт (тайланд зориулж, бүгд HANDED_OVER) ---
  let historical = 0;
  for (let monthOffset = 5; monthOffset >= 0; monthOffset--) {
    const monthStart = startOfUbMonth(addUbMonths(now, -monthOffset));
    const ordersInMonth = 6 + ((monthOffset * 3) % 5); // 6–10 захиалга

    for (let i = 0; i < ordersInMonth; i++) {
      const product = products[(monthOffset * 3 + i) % products.length]!;
      const qty = 1 + ((i + monthOffset) % 3);
      const round = product.rounds[0]!;
      const items = [
        {
          roundId: round.id,
          productId: product.id,
          nameSnapshot: product.name,
          size: null,
          color: null,
          qty,
          unitPrice: round.sellPrice,
          costPriceSnapshot: round.costPrice,
          arriveFrom: round.closeAt === null ? null : addDays(round.closeAt, round.leadMinDays),
          arriveTo: round.closeAt === null ? null : addDays(round.closeAt, round.leadMaxDays),
        },
      ];
      const subtotal = subtotalOf(items);
      const createdAt = addDays(monthStart, (i * 3) % 25);

      await createOrder({
        code: generateOrderCode(),
        customerId: customers[(monthOffset + i) % customers.length]!.id,
        status: 'HANDED_OVER',
        subtotal,
        paidAmount: subtotal,
        batchId: null,
        createdAt,
        items,
      });
      historical += 1;
    }
  }

  console.info(
    `Бэлэн: ${categories.length} ангилал, ${products.length} бараа, ${customers.length} хэрэглэгч, ` +
      `${batches.length} багц, ${plan.length} идэвхтэй захиалга, ${historical} түүхэн захиалга.`,
  );
  console.info(`Админ: ${process.env.ADMIN_EMAIL ?? 'admin@itgel.mn'} / ${process.env.ADMIN_PASSWORD ?? 'admin123'}`);
}

interface SeedOrder {
  code: string;
  customerId: string;
  status: OrderStatus;
  subtotal: number;
  /** Дэвтэрт бүртгэх орлого. Төлөгдөөгүй захиалгад 0. */
  paidAmount: number;
  batchId: string | null;
  createdAt: Date;
  items: Prisma.OrderItemUncheckedCreateWithoutOrderInput[];
}

/** Төлөвт нь тохирсон timeline огноонуудыг нөхөж бичнэ. */
async function createOrder(order: SeedOrder) {
  const flow: OrderStatus[] = ['NEW', 'CONFIRMED', 'IN_BATCH', 'IN_TRANSIT', 'ARRIVED', 'HANDED_OVER'];
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
      arrivedAt: reached('ARRIVED') ? at(10) : null,
      arrivalNotifiedAt: reached('ARRIVED') ? at(10) : null,
      handedOverAt: reached('HANDED_OVER') ? at(12) : null,
      cancelledAt: order.status === 'CANCELLED' ? at(1) : null,
      items: {
        create: order.items.map((item) => ({
          ...item,
          ...(reached('ARRIVED')
            ? { arrivedAt: at(10), arrivedQty: item.qty ?? 1 }
            : {}),
          ...(reached('HANDED_OVER') ? { handedOverAt: at(12) } : {}),
        })),
      },
    },
  });

  // Мөнгө орсон захиалгад дэвтрийн бичилт үүсгэнэ — дүн эндээс гардаг.
  if (order.paidAmount > 0) {
    await prisma.payment.create({
      data: {
        orderId: created.id,
        kind: 'PAYMENT',
        amount: order.paidAmount,
        method: 'BANK_TRANSFER',
        note: 'Шилжүүлгээр',
        actor: 'system',
        createdAt: addDays(order.createdAt, 1),
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
