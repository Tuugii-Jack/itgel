import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import {
  addUbMonths,
  endOfUbDay,
  parseUbDay,
  startOfUbDay,
  startOfUbMonth,
  ubDateString,
} from '../../lib/date.js';
import { notFound } from '../../lib/errors.js';
import { selectionsOf } from '../../lib/options.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import { computeTotals, paymentState } from '../../services/money.js';
import { orderStatusLabel } from '../../services/serialize.js';

/**
 * Архив — юу ч алдагдахгүй уншдаг давхарга.
 *
 * Ажлын дэлгэцүүд `deletedAt: null` гэж шүүдэг бол энд ЭСРЭГЭЭР: устгасан
 * бараа, гаргалт, захиалгыг ч буцаана, зөвхөн `deleted: true` гэж тэмдэглэнэ.
 * Тиймээс "тэр өдөр хэн юу авсан бэ" гэдэг хариулт хэзээ ч алга болохгүй.
 *
 * Захиалгын мөр нь нэр, үнэ, өртгөө өөртөө хуулж авдаг (`nameSnapshot`,
 * `unitPrice`, `costPriceSnapshot`) тул бараа нь хожим өөрчлөгдсөн ч
 * тухайн үеийн байдал хэвээр уншигдана.
 */
export const adminArchiveRouter = Router();

const dayParam = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD хэлбэртэй.') });

/** Мөр бүрийг ижил хэлбэрээр — гурван таб бүгд үүнийг ашиглана. */
type ItemRow = {
  id: string;
  roundId: string;
  productId: string;
  name: string;
  selections: Record<string, string>;
  size: string | null;
  color: string | null;
  qty: number;
  unitPrice: number;
  total: number;
  cancelled: boolean;
  cancelReason: string | null;
};

function itemRow(item: {
  id: string;
  roundId: string;
  productId: string;
  nameSnapshot: string;
  selections?: unknown;
  size: string | null;
  color: string | null;
  qty: number;
  unitPrice: number;
  cancelledAt: Date | null;
  cancelReason: string | null;
}): ItemRow {
  const selections = (() => {
    const fromJson = selectionsOf(item.selections);
    if (Object.keys(fromJson).length > 0) return fromJson;
    const legacy: Record<string, string> = {};
    if (item.size) legacy['Хэмжээ'] = item.size;
    if (item.color) legacy['Өнгө'] = item.color;
    return legacy;
  })();
  return {
    id: item.id,
    roundId: item.roundId,
    productId: item.productId,
    name: item.nameSnapshot,
    selections,
    size: item.size,
    color: item.color,
    qty: item.qty,
    unitPrice: item.unitPrice,
    total: item.unitPrice * item.qty,
    cancelled: item.cancelledAt !== null,
    cancelReason: item.cancelReason,
  };
}

const orderInclude = {
  customer: true,
  items: true,
  batch: { select: { id: true, name: true } },
} as const;

type ArchivedOrder = {
  id: string;
  code: string;
  status: string;
  statusLabel: string;
  createdAt: string;
  /** Захиалгыг устгасан бол архивт үлдэнэ, зөвхөн тэмдэглэгдэнэ. */
  deleted: boolean;
  customer: { id: string; name: string | null; phone: string };
  subtotal: number;
  paidAmount: number;
  refundedAmount: number;
  dueAmount: number;
  paymentState: string;
  batch: { id: string; name: string } | null;
  items: ItemRow[];
};

function archivedOrder(order: {
  id: string;
  code: string;
  status: string;
  createdAt: Date;
  deletedAt: Date | null;
  subtotal: number;
  deliveryFee: number;
  paidAmount: number;
  refundedAmount: number;
  dueAmount: number;
  customer: { id: string; name: string | null; phone: string };
  batch: { id: string; name: string } | null;
  items: Parameters<typeof itemRow>[0][];
}): ArchivedOrder {
  return {
    id: order.id,
    code: order.code,
    status: order.status,
    statusLabel: orderStatusLabel(order.status as never),
    createdAt: order.createdAt.toISOString(),
    deleted: order.deletedAt !== null,
    customer: {
      id: order.customer.id,
      name: order.customer.name,
      phone: order.customer.phone,
    },
    subtotal: order.subtotal,
    paidAmount: order.paidAmount,
    refundedAmount: order.refundedAmount,
    dueAmount: order.dueAmount,
    paymentState: paymentState(computeTotals(order)),
    batch: order.batch,
    items: order.items.map(itemRow),
  };
}

/**
 * GET /calendar?year=&month= — тухайн сарын өдөр бүрд хэдэн захиалга байсан.
 * Огноо сонгох хуанли үүн дээр тулгуурлана.
 */
adminArchiveRouter.get(
  '/calendar',
  validate({
    query: z.object({
      year: z.coerce.number().int().min(2000).max(2100),
      month: z.coerce.number().int().min(1).max(12),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ year: number; month: number }>(req);

    const from = startOfUbMonth(new Date(Date.UTC(q.year, q.month - 1, 1, 12)));
    const to = addUbMonths(from, 1);

    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: from, lt: to } },
      select: { createdAt: true, subtotal: true, deletedAt: true },
    });

    const byDay = new Map<string, { orders: number; revenue: number }>();
    for (const order of orders) {
      const key = ubDateString(order.createdAt);
      const entry = byDay.get(key) ?? { orders: 0, revenue: 0 };
      entry.orders += 1;
      if (order.deletedAt === null) entry.revenue += order.subtotal;
      byDay.set(key, entry);
    }

    res.json({
      data: {
        year: q.year,
        month: q.month,
        days: [...byDay.entries()]
          .map(([date, v]) => ({ date, ...v }))
          .sort((a, b) => a.date.localeCompare(b.date)),
        total: orders.length,
      },
    });
  }),
);

/** GET /day?date=YYYY-MM-DD — тэр өдөр хэн юу захиалсан бэ. */
adminArchiveRouter.get(
  '/day',
  validate({ query: dayParam }),
  asyncHandler(async (req, res) => {
    const { date } = query<z.infer<typeof dayParam>>(req);
    const day = parseUbDay(date);

    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: startOfUbDay(day), lte: endOfUbDay(day) } },
      include: orderInclude,
      orderBy: { createdAt: 'asc' },
    });

    const rows = orders.map(archivedOrder);
    const live = rows.filter((o) => !o.deleted && o.status !== 'CANCELLED');

    res.json({
      data: {
        date,
        summary: {
          orderCount: live.length,
          customerCount: new Set(live.map((o) => o.customer.id)).size,
          qty: live.reduce(
            (sum, o) => sum + o.items.filter((i) => !i.cancelled).reduce((s, i) => s + i.qty, 0),
            0,
          ),
          revenue: live.reduce((sum, o) => sum + o.subtotal, 0),
          cancelledCount: rows.length - live.length,
        },
        orders: rows,
      },
    });
  }),
);

/**
 * GET /product/:id — нэг барааны бүрэн түүх.
 * Устгасан гаргалт, устгасан бараа ч энд харагдана.
 */
adminArchiveRouter.get(
  '/product/:id',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        category: { select: { name: true } },
        rounds: { orderBy: { roundNo: 'asc' } },
      },
    });
    if (!product) throw notFound('Бараа олдсонгүй.');

    const items = await prisma.orderItem.findMany({
      where: { productId: product.id },
      include: { order: { include: orderInclude } },
      orderBy: { order: { createdAt: 'desc' } },
    });

    const live = items.filter(
      (i) => i.cancelledAt === null && i.order.deletedAt === null && i.order.status !== 'CANCELLED',
    );

    res.json({
      data: {
        product: {
          id: product.id,
          name: product.name,
          category: product.category?.name ?? null,
          images: product.images,
          deleted: product.deletedAt !== null,
          createdAt: product.createdAt.toISOString(),
        },
        rounds: product.rounds.map((round) => {
          const roundItems = items.filter((i) => i.roundId === round.id);
          const roundLive = roundItems.filter(
            (i) =>
              i.cancelledAt === null &&
              i.order.deletedAt === null &&
              i.order.status !== 'CANCELLED',
          );
          return {
            id: round.id,
            roundNo: round.roundNo,
            status: round.status,
            deleted: round.deletedAt !== null,
            sellPrice: round.sellPrice,
            costPrice: round.costPrice,
            closeAt: round.closeAt?.toISOString() ?? null,
            createdAt: round.createdAt.toISOString(),
            customerCount: new Set(roundLive.map((i) => i.order.customerId)).size,
            qty: roundLive.reduce((sum, i) => sum + i.qty, 0),
            revenue: roundLive.reduce((sum, i) => sum + i.unitPrice * i.qty, 0),
          };
        }),
        summary: {
          roundCount: product.rounds.length,
          customerCount: new Set(live.map((i) => i.order.customerId)).size,
          orderCount: new Set(live.map((i) => i.orderId)).size,
          qty: live.reduce((sum, i) => sum + i.qty, 0),
          revenue: live.reduce((sum, i) => sum + i.unitPrice * i.qty, 0),
          profit: live.reduce((sum, i) => sum + (i.unitPrice - i.costPriceSnapshot) * i.qty, 0),
        },
        /** Хэн хэзээ авсан бэ — шинэ нь эхэнд. */
        buyers: items.map((item) => ({
          ...itemRow(item),
          roundNo: product.rounds.find((r) => r.id === item.roundId)?.roundNo ?? null,
          orderId: item.order.id,
          code: item.order.code,
          status: item.order.status,
          statusLabel: orderStatusLabel(item.order.status),
          orderDeleted: item.order.deletedAt !== null,
          createdAt: item.order.createdAt.toISOString(),
          customer: {
            id: item.order.customer.id,
            name: item.order.customer.name,
            phone: item.order.customer.phone,
          },
        })),
      },
    });
  }),
);

/** GET /customer/:id — нэг хүний бүх захиалгын түүх. */
adminArchiveRouter.get(
  '/customer/:id',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!customer) throw notFound('Хэрэглэгч олдсонгүй.');

    const orders = await prisma.order.findMany({
      where: { customerId: customer.id },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
    });

    const rows = orders.map(archivedOrder);
    const live = rows.filter((o) => !o.deleted && o.status !== 'CANCELLED');

    // Хамгийн их авсан бараа — "энэ хүн юу авдаг вэ" гэдгийг шууд харуулна.
    const byProduct = new Map<string, { name: string; productId: string; qty: number; total: number }>();
    for (const order of live) {
      for (const item of order.items) {
        if (item.cancelled) continue;
        const entry = byProduct.get(item.productId) ?? {
          name: item.name,
          productId: item.productId,
          qty: 0,
          total: 0,
        };
        entry.qty += item.qty;
        entry.total += item.total;
        byProduct.set(item.productId, entry);
      }
    }

    res.json({
      data: {
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          district: customer.district,
          khoroo: customer.khoroo,
          addressText: customer.addressText,
          createdAt: customer.createdAt.toISOString(),
        },
        summary: {
          orderCount: live.length,
          cancelledCount: rows.length - live.length,
          qty: live.reduce(
            (sum, o) => sum + o.items.filter((i) => !i.cancelled).reduce((s, i) => s + i.qty, 0),
            0,
          ),
          spent: live.reduce((sum, o) => sum + o.paidAmount - o.refundedAmount, 0),
          dueTotal: live.reduce((sum, o) => sum + Math.max(0, o.dueAmount), 0),
          firstOrderAt: rows.at(-1)?.createdAt ?? null,
          lastOrderAt: rows[0]?.createdAt ?? null,
        },
        topProducts: [...byProduct.values()].sort((a, b) => b.qty - a.qty).slice(0, 10),
        orders: rows,
      },
    });
  }),
);

/**
 * GET /search?q= — архиваас бараа, хэрэглэгч хайх.
 * Устгасныг ч олно — архивын гол утга нь тэр.
 */
adminArchiveRouter.get(
  '/search',
  validate({ query: z.object({ q: z.string().trim().min(1).max(80) }) }),
  asyncHandler(async (req, res) => {
    const { q } = query<{ q: string }>(req);

    const [products, customers] = await Promise.all([
      prisma.product.findMany({
        where: { name: { contains: q, mode: 'insensitive' } },
        select: {
          id: true,
          name: true,
          images: true,
          deletedAt: true,
          _count: { select: { rounds: true } },
        },
        take: 20,
        orderBy: { name: 'asc' },
      }),
      prisma.customer.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
          ],
        },
        select: { id: true, name: true, phone: true, _count: { select: { orders: true } } },
        take: 20,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.json({
      data: {
        products: products.map((p) => ({
          id: p.id,
          name: p.name,
          image: p.images[0] ?? null,
          deleted: p.deletedAt !== null,
          roundCount: p._count.rounds,
        })),
        customers: customers.map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          orderCount: c._count.orders,
        })),
      },
    });
  }),
);
