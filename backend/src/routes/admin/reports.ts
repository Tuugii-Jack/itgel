import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { addUbMonths, startOfUbMonth, ubMonthKey } from '../../lib/date.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';

export const adminReportsRouter = Router();

const PERIOD_MONTHS = { '3m': 3, '6m': 6, '1y': 12 } as const;

function parseProductIds(raw?: string): Set<string> {
  if (!raw?.trim()) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 200),
  );
}

function periodFrom(period: keyof typeof PERIOD_MONTHS): Date {
  return startOfUbMonth(addUbMonths(new Date(), -(PERIOD_MONTHS[period] - 1)));
}

const revenueQuery = z.object({
  period: z.enum(['3m', '6m', '1y']).default('6m'),
  productIds: z.string().optional(),
});

/**
 * GET /reports/revenue — сарын борлуулалт (зарах үнэ), буцаалт.
 */
adminReportsRouter.get(
  '/revenue',
  validate({ query: revenueQuery }),
  asyncHandler(async (req, res) => {
    const { period, productIds } = query<z.infer<typeof revenueQuery>>(req);
    const months = PERIOD_MONTHS[period];
    const from = periodFrom(period);
    const ids = parseProductIds(productIds);

    const [soldItems, returnedItems] = await Promise.all([
      prisma.orderItem.findMany({
        where: {
          cancelledAt: null,
          handedOverAt: { gte: from },
          ...(ids.size > 0 ? { productId: { in: [...ids] } } : {}),
          order: { deletedAt: null },
        },
        select: {
          qty: true,
          unitPrice: true,
          handedOverAt: true,
          orderId: true,
        },
      }),
      prisma.orderItem.findMany({
        where: {
          cancelledAt: { gte: from },
          ...(ids.size > 0 ? { productId: { in: [...ids] } } : {}),
          order: { deletedAt: null },
        },
        select: {
          qty: true,
          unitPrice: true,
          cancelledAt: true,
        },
      }),
    ]);

    const buckets = new Map<
      string,
      { sold: number; returned: number; soldQty: number; returnedQty: number; orders: Set<string> }
    >();
    for (let i = 0; i < months; i++) {
      buckets.set(ubMonthKey(addUbMonths(from, i)), {
        sold: 0,
        returned: 0,
        soldQty: 0,
        returnedQty: 0,
        orders: new Set(),
      });
    }

    for (const item of soldItems) {
      if (!item.handedOverAt) continue;
      const bucket = buckets.get(ubMonthKey(item.handedOverAt));
      if (!bucket) continue;
      bucket.sold += item.unitPrice * item.qty;
      bucket.soldQty += item.qty;
      bucket.orders.add(item.orderId);
    }
    for (const item of returnedItems) {
      if (!item.cancelledAt) continue;
      const bucket = buckets.get(ubMonthKey(item.cancelledAt));
      if (!bucket) continue;
      bucket.returned += item.unitPrice * item.qty;
      bucket.returnedQty += item.qty;
    }

    const series = [...buckets.entries()].map(([month, value]) => ({
      month,
      sold: value.sold,
      returned: value.returned,
      net: value.sold - value.returned,
      orders: value.orders.size,
      soldQty: value.soldQty,
      returnedQty: value.returnedQty,
    }));

    const sold = series.reduce((sum, s) => sum + s.sold, 0);
    const returned = series.reduce((sum, s) => sum + s.returned, 0);
    const orders = series.reduce((sum, s) => sum + s.orders, 0);

    res.json({
      data: {
        period,
        series,
        totals: {
          sold,
          returned,
          net: sold - returned,
          orders,
          soldQty: series.reduce((sum, s) => sum + s.soldQty, 0),
          returnedQty: series.reduce((sum, s) => sum + s.returnedQty, 0),
        },
      },
    });
  }),
);

const productsQuery = z.object({
  period: z.enum(['3m', '6m', '1y']).default('6m'),
  productIds: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(300).default(200),
});

/** GET /reports/products — бараа бүрийн зарагдсан / буцаасан (зарах үнэ). */
adminReportsRouter.get(
  '/products',
  validate({ query: productsQuery }),
  asyncHandler(async (req, res) => {
    const { period, productIds, limit } = query<z.infer<typeof productsQuery>>(req);
    const from = periodFrom(period);
    const ids = parseProductIds(productIds);

    const [soldItems, returnedItems] = await Promise.all([
      prisma.orderItem.findMany({
        where: {
          cancelledAt: null,
          handedOverAt: { gte: from },
          ...(ids.size > 0 ? { productId: { in: [...ids] } } : {}),
          order: { deletedAt: null },
        },
        select: {
          productId: true,
          qty: true,
          unitPrice: true,
          nameSnapshot: true,
          product: { select: { id: true, name: true, category: { select: { name: true } } } },
        },
      }),
      prisma.orderItem.findMany({
        where: {
          cancelledAt: { gte: from },
          ...(ids.size > 0 ? { productId: { in: [...ids] } } : {}),
          order: { deletedAt: null },
        },
        select: {
          productId: true,
          qty: true,
          unitPrice: true,
          nameSnapshot: true,
          product: { select: { id: true, name: true, category: { select: { name: true } } } },
        },
      }),
    ]);

    const rows = new Map<
      string,
      {
        productId: string;
        name: string;
        category: string | null;
        soldQty: number;
        soldAmount: number;
        returnedQty: number;
        returnedAmount: number;
        sellPrice: number;
      }
    >();

    const ensure = (item: {
      productId: string;
      nameSnapshot: string;
      unitPrice: number;
      product: { id: string; name: string; category: { name: string } | null } | null;
    }) => {
      const row = rows.get(item.productId) ?? {
        productId: item.productId,
        name: item.product?.name ?? item.nameSnapshot,
        category: item.product?.category?.name ?? null,
        soldQty: 0,
        soldAmount: 0,
        returnedQty: 0,
        returnedAmount: 0,
        sellPrice: item.unitPrice,
      };
      row.sellPrice = item.unitPrice;
      rows.set(item.productId, row);
      return row;
    };

    for (const item of soldItems) {
      const row = ensure(item);
      row.soldQty += item.qty;
      row.soldAmount += item.unitPrice * item.qty;
    }
    for (const item of returnedItems) {
      const row = ensure(item);
      row.returnedQty += item.qty;
      row.returnedAmount += item.unitPrice * item.qty;
    }

    const data = [...rows.values()]
      .map((row) => ({
        ...row,
        netQty: row.soldQty - row.returnedQty,
        netAmount: row.soldAmount - row.returnedAmount,
      }))
      .sort((a, b) => b.soldAmount - a.soldAmount || b.returnedAmount - a.returnedAmount)
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
        prisma.productRound.count({
          where: { deletedAt: null, status: 'ACTIVE', product: { deletedAt: null } },
        }),
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
