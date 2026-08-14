import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import {
  addUbMonths,
  diffUbDays,
  endOfUbDay,
  parseUbDay,
  startOfUbMonth,
  ubDateString,
} from '../lib/date.js';
import {
  itemSelections,
  sizeColorFromSelections,
  tallyVariants,
  type KindTally,
  type VariantTally,
} from '../lib/options.js';

export type ClosedFilter = 'all' | 'open' | 'closed';

export interface OrdersByProductQuery {
  closed: ClosedFilter;
  year?: number;
  month?: number;
  /** Сонгосон өдрүүд — жишээ нь 1, 5, 14. Хоосон бол сар/оныг бүхэлд нь. */
  days?: number[];
  q?: string;
  page: number;
  pageSize: number;
}

const liveItemWhere: Prisma.OrderItemWhereInput = {
  cancelledAt: null,
  order: { deletedAt: null, status: { not: 'CANCELLED' } },
};

function dayRange(year: number, month: number, day: number): { gte: Date; lte: Date } | null {
  const stamp = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const start = parseUbDay(stamp);
  if (ubDateString(start) !== stamp) return null;
  return { gte: start, lte: endOfUbDay(start) };
}

function closeAtWhere(
  q: Pick<OrdersByProductQuery, 'year' | 'month' | 'days'>,
): Prisma.ProductRoundWhereInput | null {
  if (!q.year) return null;
  const selected = [...new Set(q.days ?? [])].filter((d) => d >= 1 && d <= 31);
  if (q.month && selected.length > 0) {
    const ranges = selected
      .map((d) => dayRange(q.year!, q.month!, d))
      .filter((r): r is { gte: Date; lte: Date } => r !== null);
    if (ranges.length === 0) return { closeAt: { in: [] } };
    if (ranges.length === 1) return { closeAt: ranges[0] };
    return { OR: ranges.map((closeAt) => ({ closeAt })) };
  }
  if (q.month) {
    const start = startOfUbMonth(
      parseUbDay(`${q.year}-${String(q.month).padStart(2, '0')}-01`),
    );
    return { closeAt: { gte: start, lte: new Date(addUbMonths(start, 1).getTime() - 1) } };
  }
  const start = startOfUbMonth(parseUbDay(`${q.year}-01-01`));
  return { closeAt: { gte: start, lte: new Date(addUbMonths(start, 12).getTime() - 1) } };
}

function closedWhere(closed: ClosedFilter, now: Date): Prisma.ProductRoundWhereInput {
  if (closed === 'closed') {
    return {
      OR: [{ status: 'CLOSED' }, { closeAt: { lte: now } }],
    };
  }
  if (closed === 'open') {
    return {
      status: { in: ['ACTIVE', 'HIDDEN'] },
      OR: [{ closeAt: null }, { closeAt: { gt: now } }],
    };
  }
  return {};
}

function roundListWhere(q: OrdersByProductQuery, now: Date): Prisma.ProductRoundWhereInput {
  const dateFilter = closeAtWhere(q);
  const statusFilter = closedWhere(q.closed, now);
  const parts: Prisma.ProductRoundWhereInput[] = [];
  if (Object.keys(statusFilter).length > 0) parts.push(statusFilter);
  if (dateFilter) parts.push(dateFilter);
  if (q.q) parts.push({ product: { name: { contains: q.q, mode: 'insensitive' } } });
  return {
    deletedAt: null,
    ...(parts.length > 0 ? { AND: parts } : {}),
    orderItems: { some: liveItemWhere },
  };
}

export interface OrdersByProductRow {
  roundId: string;
  roundNo: number;
  productId: string;
  name: string;
  image: string | null;
  status: string;
  closed: boolean;
  closeAt: string | null;
  createdAt: string;
  daysOpen: number | null;
  daysSinceClose: number | null;
  sellPrice: number;
  customerCount: number;
  orderCount: number;
  qty: number;
  revenue: number;
  byKind: KindTally[];
  byVariant: VariantTally[];
}

export async function listOrdersByProduct(q: OrdersByProductQuery): Promise<{
  rows: OrdersByProductRow[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const now = new Date();
  const where = roundListWhere(q, now);

  const [total, rounds] = await Promise.all([
    prisma.productRound.count({ where }),
    prisma.productRound.findMany({
      where,
      orderBy: [{ closeAt: 'desc' }, { createdAt: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        product: { select: { id: true, name: true, images: true } },
      },
    }),
  ]);

  const items =
    rounds.length === 0
      ? []
      : await prisma.orderItem.findMany({
          where: { roundId: { in: rounds.map((r) => r.id) }, ...liveItemWhere },
          select: {
            roundId: true,
            qty: true,
            unitPrice: true,
            selections: true,
            size: true,
            color: true,
            orderId: true,
            order: { select: { customerId: true } },
          },
        });

  const byRound = new Map<
    string,
    {
      qty: number;
      revenue: number;
      customers: Set<string>;
      orders: Set<string>;
      lines: {
        selections: Record<string, string>;
        size: string | null;
        color: string | null;
        qty: number;
      }[];
    }
  >();

  for (const item of items) {
    const selections = itemSelections(item);
    const { size, color } = sizeColorFromSelections(selections);
    const bucket =
      byRound.get(item.roundId) ??
      {
        qty: 0,
        revenue: 0,
        customers: new Set<string>(),
        orders: new Set<string>(),
        lines: [],
      };
    bucket.qty += item.qty;
    bucket.revenue += item.unitPrice * item.qty;
    bucket.customers.add(item.order.customerId);
    bucket.orders.add(item.orderId);
    bucket.lines.push({
      selections,
      size: size ?? item.size,
      color: color ?? item.color,
      qty: item.qty,
    });
    byRound.set(item.roundId, bucket);
  }

  const rows: OrdersByProductRow[] = rounds.map((round) => {
    const stats = byRound.get(round.id);
    const tallied = tallyVariants(stats?.lines ?? []);
    const closed =
      round.status === 'CLOSED' || (round.closeAt !== null && round.closeAt <= now);
    return {
      roundId: round.id,
      roundNo: round.roundNo,
      productId: round.product.id,
      name: round.product.name,
      image: round.product.images[0] ?? null,
      status: round.status,
      closed,
      closeAt: round.closeAt?.toISOString() ?? null,
      createdAt: round.createdAt.toISOString(),
      daysOpen:
        round.closeAt !== null ? Math.max(0, diffUbDays(round.closeAt, round.createdAt)) : null,
      daysSinceClose:
        closed && round.closeAt ? Math.max(0, diffUbDays(now, round.closeAt)) : null,
      sellPrice: round.sellPrice,
      customerCount: stats?.customers.size ?? 0,
      orderCount: stats?.orders.size ?? 0,
      qty: stats?.qty ?? 0,
      revenue: stats?.revenue ?? 0,
      byKind: tallied.byKind,
      byVariant: tallied.byVariant,
    };
  });

  return { rows, total, page: q.page, pageSize: q.pageSize };
}

export async function ordersByProductDates(closed: ClosedFilter): Promise<
  { date: string; year: number; month: number; day: number; count: number }[]
> {
  const now = new Date();
  const rounds = await prisma.productRound.findMany({
    where: {
      deletedAt: null,
      closeAt: { not: null },
      ...closedWhere(closed, now),
      orderItems: { some: liveItemWhere },
    },
    select: { closeAt: true },
  });

  const counts = new Map<string, number>();
  for (const r of rounds) {
    if (!r.closeAt) continue;
    const date = ubDateString(r.closeAt);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, count]) => {
      const [y, m, d] = date.split('-').map(Number);
      return { date, year: y!, month: m!, day: d!, count };
    });
}
