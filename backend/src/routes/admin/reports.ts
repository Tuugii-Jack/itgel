import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { addUbMonths, startOfUbMonth, ubMonthKey } from '../../lib/date.js';
import { marginPercent } from '../../lib/money.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';

export const adminReportsRouter = Router();

const PERIOD_MONTHS = { '3m': 3, '6m': 6, '1y': 12 } as const;

const revenueQuery = z.object({ period: z.enum(['3m', '6m', '1y']).default('6m') });

/**
 * GET /reports/revenue — сар тус бүрийн борлуулалт, ашиг.
 * Зөвхөн `HANDED_OVER` захиалгууд тооцогдоно.
 */
adminReportsRouter.get(
  '/revenue',
  validate({ query: revenueQuery }),
  asyncHandler(async (req, res) => {
    const { period } = query<z.infer<typeof revenueQuery>>(req);
    const months = PERIOD_MONTHS[period];

    const now = new Date();
    const from = startOfUbMonth(addUbMonths(now, -(months - 1)));

    const orders = await prisma.order.findMany({
      where: { deletedAt: null, status: 'HANDED_OVER', handedOverAt: { gte: from } },
      select: {
        handedOverAt: true,
        deliveryFee: true,
        // Цуцлагдсан мөр борлуулалт, ашгийн аль алинд ордоггүй.
        items: { where: { cancelledAt: null } },
      },
    });

    const buckets = new Map<string, { revenue: number; profit: number; orders: number; items: number }>();
    for (let i = 0; i < months; i++) {
      buckets.set(ubMonthKey(addUbMonths(from, i)), { revenue: 0, profit: 0, orders: 0, items: 0 });
    }

    for (const order of orders) {
      const key = ubMonthKey(order.handedOverAt!);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      for (const item of order.items) {
        bucket.revenue += item.unitPrice * item.qty;
        bucket.profit += (item.unitPrice - item.costPriceSnapshot) * item.qty;
        bucket.items += item.qty;
      }
      bucket.orders += 1;
    }

    const series = [...buckets.entries()].map(([month, value]) => ({
      month,
      revenue: value.revenue,
      profit: value.profit,
      orders: value.orders,
      items: value.items,
      marginPercent: value.revenue > 0 ? Math.round((value.profit / value.revenue) * 100) : 0,
    }));

    const totalRevenue = series.reduce((sum, s) => sum + s.revenue, 0);
    const totalProfit = series.reduce((sum, s) => sum + s.profit, 0);

    res.json({
      data: {
        period,
        series,
        totals: {
          revenue: totalRevenue,
          profit: totalProfit,
          orders: series.reduce((sum, s) => sum + s.orders, 0),
          marginPercent: totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0,
          averageOrderValue:
            series.reduce((sum, s) => sum + s.orders, 0) > 0
              ? Math.round(totalRevenue / series.reduce((sum, s) => sum + s.orders, 0))
              : 0,
        },
      },
    });
  }),
);

const productsQuery = z.object({
  period: z.enum(['3m', '6m', '1y']).default('6m'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** GET /reports/products — ашгийн хувиар эрэмбэлсэн. */
adminReportsRouter.get(
  '/products',
  validate({ query: productsQuery }),
  asyncHandler(async (req, res) => {
    const { period, limit } = query<z.infer<typeof productsQuery>>(req);
    const from = startOfUbMonth(addUbMonths(new Date(), -(PERIOD_MONTHS[period] - 1)));

    const items = await prisma.orderItem.findMany({
      where: {
        cancelledAt: null,
        order: { deletedAt: null, status: 'HANDED_OVER', handedOverAt: { gte: from } },
      },
      include: {
        product: { select: { id: true, name: true, category: { select: { name: true } } } },
      },
    });

    const rows = new Map<
      string,
      {
        productId: string;
        name: string;
        category: string | null;
        qty: number;
        revenue: number;
        profit: number;
        /** Хамгийн сүүлд зарагдсан үеийн үнэ, өртөг. */
        costPrice: number;
        sellPrice: number;
      }
    >();

    for (const item of items) {
      const row = rows.get(item.productId) ?? {
        productId: item.productId,
        name: item.product?.name ?? item.nameSnapshot,
        category: item.product?.category?.name ?? null,
        qty: 0,
        revenue: 0,
        profit: 0,
        costPrice: item.costPriceSnapshot,
        sellPrice: item.unitPrice,
      };
      row.qty += item.qty;
      row.revenue += item.unitPrice * item.qty;
      row.profit += (item.unitPrice - item.costPriceSnapshot) * item.qty;
      row.costPrice = item.costPriceSnapshot;
      row.sellPrice = item.unitPrice;
      rows.set(item.productId, row);
    }

    const data = [...rows.values()]
      .map((row) => ({
        ...row,
        marginPercent: marginPercent(row.revenue, row.revenue - row.profit),
      }))
      .sort((a, b) => b.marginPercent - a.marginPercent || b.profit - a.profit)
      .slice(0, limit);

    res.json({ data, meta: { period, total: rows.size } });
  }),
);

/** Хяналтын самбарын товч үзүүлэлт. */
adminReportsRouter.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const [newOrders, inTransit, arrived, pendingDeliveries, activeProducts, paymentClaims] =
      await Promise.all([
        prisma.order.count({ where: { deletedAt: null, status: 'NEW' } }),
        prisma.order.count({ where: { deletedAt: null, status: 'IN_TRANSIT' } }),
        prisma.order.count({ where: { deletedAt: null, status: 'ARRIVED' } }),
        prisma.delivery.count({ where: { status: { not: 'DELIVERED' } } }),
        // Зарагдаж буй тойргийн тоо — нэг бараа хэд хэдэн удаа гарч болно.
        prisma.productRound.count({
          where: { deletedAt: null, status: 'ACTIVE', product: { deletedAt: null } },
        }),
        // Хэрэглэгч шилжүүлсэн гэсэн ч мөнгө нь дэвтэрт ороогүй — шалгах ёстой.
        prisma.order.count({
          where: {
            deletedAt: null,
            status: { not: 'CANCELLED' },
            paymentClaimedAt: { not: null },
            dueAmount: { gt: 0 },
          },
        }),
      ]);

    res.json({
      data: { newOrders, inTransit, arrived, pendingDeliveries, activeProducts, paymentClaims },
    });
  }),
);
