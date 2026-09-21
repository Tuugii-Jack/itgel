import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { startOfUbDay, endOfUbDay, parseUbDay } from '../lib/date.js';
import { leasingPayeeSums } from '../lib/money.js';
import { leasingResaleMoneyShare } from '../lib/leasingAccess.js';

export const READY_SALES_TOTALS_BATCH = 200;

/** OWNER (шүүлтгүй) бүх эзний бараа; LEASING зөвхөн өөрийн. `=== undefined` биш. */
export function leasingReadyOwnItems<T extends {
  cancelledAt: Date | null;
  round: { ownerKind: string | null; ownerAdminId: string | null; closeAt: Date | null };
}>(items: T[], ownerAdminId?: string): T[] {
  return items.filter((item) => {
    if (item.cancelledAt != null) return false;
    if (item.round.ownerKind !== 'LEASING' || item.round.closeAt !== null) return false;
    if (!ownerAdminId) return true;
    return item.round.ownerAdminId === ownerAdminId;
  });
}

export type ReadySalesTotals = {
  received: number;
  refunded: number;
  receivable: number;
  unallocatedPaid: number;
  unallocatedRefunded: number;
};

export function leasingReadyMoney<
  T extends {
    cancelledAt: Date | null;
    qty: number;
    unitPrice: number;
    round: { ownerKind: string | null; ownerAdminId: string | null; closeAt: Date | null };
  },
>(input: {
  ownerAdminId?: string;
  items: T[];
  paidAmount: number;
  refundedAmount: number;
  dueAmount: number;
}): {
  ownItems: T[];
  received: number;
  refunded: number;
  due: number;
  mixed: boolean;
  attributed: boolean;
  unallocatedPaid: number;
  unallocatedRefunded: number;
} {
  const readyItems = input.items.filter((item) => item.round.closeAt === null);
  const ownItems = leasingReadyOwnItems(input.items, input.ownerAdminId);
  const share = leasingResaleMoneyShare({
    ownerAdminId: input.ownerAdminId,
    items: readyItems,
    paidAmount: input.paidAmount,
    refundedAmount: input.refundedAmount,
    dueAmount: input.dueAmount,
  });
  return {
    ownItems,
    received: share.paidAmount,
    refunded: share.refundedAmount,
    due: share.dueAmount,
    mixed: share.mixed,
    attributed: share.attributed,
    unallocatedPaid: share.unallocatedPaid,
    unallocatedRefunded: share.unallocatedRefunded,
  };
}

export function addReadySalesTotals(
  acc: ReadySalesTotals,
  slice: {
    received: number;
    refunded: number;
    due: number;
    attributed: boolean;
    unallocatedPaid: number;
    unallocatedRefunded: number;
  },
): void {
  acc.received += slice.received;
  acc.refunded += slice.refunded;
  acc.receivable += slice.due;
  if (slice.attributed) {
    acc.unallocatedPaid += slice.unallocatedPaid;
    acc.unallocatedRefunded += slice.unallocatedRefunded;
  }
}

export async function reduceOrderPages<T extends { id: string }, A>(
  fetchPage: (cursor: string | undefined) => Promise<T[]>,
  acc: A,
  add: (acc: A, row: T) => void,
): Promise<A> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await fetchPage(cursor);
    if (rows.length === 0) break;
    for (const row of rows) add(acc, row);
    if (rows.length < READY_SALES_TOTALS_BATCH) break;
    cursor = rows[rows.length - 1]!.id;
  }
  return acc;
}

export async function leasingReadyStockSummary(ownerAdminId?: string) {
  const rounds = await prisma.productRound.findMany({
    where: {
      ownerKind: 'LEASING',
      deletedAt: null,
      closeAt: null,
      ...(ownerAdminId ? { ownerAdminId } : {}),
    },
    select: { stock: true, reserved: true, available: true, status: true },
  });
  return {
    onHand: rounds.reduce((sum, r) => sum + r.stock, 0),
    reserved: rounds.reduce((sum, r) => sum + r.reserved, 0),
    available: rounds.reduce((sum, r) => sum + r.available, 0),
    roundCount: rounds.length,
  };
}

const moneyOrderSelect = {
  id: true,
  dueAmount: true,
  items: {
    include: {
      round: { select: { id: true, ownerAdminId: true, closeAt: true, ownerKind: true } },
    },
  },
  payments: { select: { kind: true, payeeKind: true, amount: true } },
} as const;

type ReadyMoneyOrder = Prisma.OrderGetPayload<{ select: typeof moneyOrderSelect }>;

export async function leasingReadySales(input: {
  ownerAdminId?: string;
  from?: string;
  to?: string;
  productId?: string;
  status?: string;
  page: number;
  pageSize: number;
}) {
  const from = input.from ? startOfUbDay(parseUbDay(input.from)) : undefined;
  const to = input.to ? endOfUbDay(parseUbDay(input.to)) : undefined;
  const where: Prisma.OrderWhereInput = {
    deletedAt: null,
    payeeKind: 'LEASING',
    isLeasing: false,
    items: {
      some: {
        cancelledAt: null,
        round: {
          ownerKind: 'LEASING',
          closeAt: null,
          ...(input.ownerAdminId ? { ownerAdminId: input.ownerAdminId } : {}),
        },
        ...(input.productId ? { productId: input.productId } : {}),
      },
    },
    ...(from || to ? { createdAt: { gte: from, lte: to } } : {}),
    ...(input.status ? { status: input.status as Prisma.EnumOrderStatusFilter['equals'] } : {}),
  };

  const itemInclude = {
    include: {
      round: { select: { id: true, ownerAdminId: true, closeAt: true, ownerKind: true } },
    },
  } as const;

  const [total, orders, totalsAcc] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        items: itemInclude,
        payments: { orderBy: { createdAt: 'asc' } },
      },
    }),
    reduceOrderPages<ReadyMoneyOrder, ReadySalesTotals>(
      (cursor) =>
        prisma.order.findMany({
          where,
          take: READY_SALES_TOTALS_BATCH,
          orderBy: { id: 'asc' },
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          select: moneyOrderSelect,
        }),
      { received: 0, refunded: 0, receivable: 0, unallocatedPaid: 0, unallocatedRefunded: 0 },
      (acc, order) => {
        const sums = leasingPayeeSums(order.payments);
        addReadySalesTotals(
          acc,
          leasingReadyMoney({
            ownerAdminId: input.ownerAdminId,
            items: order.items,
            paidAmount: sums.paid,
            refundedAmount: sums.refunded,
            dueAmount: order.dueAmount,
          }),
        );
      },
    ),
  ]);

  const destRoundIds = [
    ...new Set(
      orders.flatMap((order) =>
        leasingReadyOwnItems(order.items, input.ownerAdminId).map((item) => item.round.id),
      ),
    ),
  ];
  const transferLines =
    destRoundIds.length > 0
      ? await prisma.readyStockTransferLine.findMany({
          where: { destRoundId: { in: destRoundIds } },
          select: {
            destRoundId: true,
            transfer: { select: { id: true, sourceOrderId: true, paidKeptAmount: true } },
          },
        })
      : [];
  const transferByRound = new Map(transferLines.map((line) => [line.destRoundId, line.transfer]));

  return {
    meta: { total, page: input.page, pageSize: input.pageSize, pages: Math.ceil(total / input.pageSize) },
    totals: {
      received: totalsAcc.received,
      refunded: totalsAcc.refunded,
      net: totalsAcc.received - totalsAcc.refunded,
      receivable: totalsAcc.receivable,
      unallocatedPaid: totalsAcc.unallocatedPaid,
      unallocatedRefunded: totalsAcc.unallocatedRefunded,
    },
    rows: orders.map((order) => {
      const sums = leasingPayeeSums(order.payments);
      const slice = leasingReadyMoney({
        ownerAdminId: input.ownerAdminId,
        items: order.items,
        paidAmount: sums.paid,
        refundedAmount: sums.refunded,
        dueAmount: order.dueAmount,
      });
      const sourceTransfer = slice.ownItems
        .map((item) => transferByRound.get(item.round.id) ?? null)
        .find(Boolean);
      return {
        id: order.id,
        code: order.code,
        status: order.status,
        createdAt: order.createdAt.toISOString(),
        customer: {
          id: order.customer.id,
          name: order.customer.name?.trim() || 'Нэргүй',
          phone: order.customer.phone,
        },
        items: slice.ownItems.map((item) => ({
          id: item.id,
          name: item.nameSnapshot,
          qty: item.qty,
          unitPrice: item.unitPrice,
          total: item.unitPrice * item.qty,
          cancelled: item.cancelledAt != null,
          transferredAt: item.transferredAt?.toISOString() ?? null,
        })),
        paidAmount: slice.received,
        refundedAmount: slice.refunded,
        dueAmount: slice.due,
        unallocatedPaid: slice.unallocatedPaid,
        unallocatedRefunded: slice.unallocatedRefunded,
        attributedMoney: slice.attributed,
        mixedOwnership: slice.mixed,
        paymentState:
          slice.due < 0
            ? 'OVERPAID'
            : slice.due === 0
              ? 'PAID'
              : slice.received > 0
                ? 'PARTIAL'
                : 'UNPAID',
        sourceTransfer: sourceTransfer
          ? {
              id: sourceTransfer.id,
              sourceOrderId: sourceTransfer.sourceOrderId,
              paidKeptAmount: sourceTransfer.paidKeptAmount,
            }
          : null,
      };
    }),
  };
}
