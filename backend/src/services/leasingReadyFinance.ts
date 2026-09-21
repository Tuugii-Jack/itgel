import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { startOfUbDay, endOfUbDay, parseUbDay } from '../lib/date.js';
import { attributedShare, subtotalOf } from '../lib/money.js';

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
} {
  const all = leasingReadyOwnItems(input.items, undefined);
  const ownItems = leasingReadyOwnItems(input.items, input.ownerAdminId);
  const owners = [
    ...new Set(all.map((item) => item.round.ownerAdminId).filter((id): id is string => Boolean(id))),
  ];
  const mixed = owners.length > 1;
  const scoped = Boolean(input.ownerAdminId) && mixed;
  const ownSub = subtotalOf(ownItems);
  const allSub = subtotalOf(all);
  const received = scoped ? attributedShare(input.paidAmount, ownSub, allSub) : input.paidAmount;
  const refunded = scoped ? attributedShare(input.refundedAmount, ownSub, allSub) : input.refundedAmount;
  return {
    ownItems,
    received,
    refunded,
    due: scoped ? Math.max(0, ownSub - (received - refunded)) : input.dueAmount,
    mixed,
  };
}

function leasingPaySums(payments: Array<{ kind: string; payeeKind: string | null; amount: number }>) {
  let paid = 0;
  let refunded = 0;
  for (const payment of payments) {
    if (payment.payeeKind === 'SHOP') continue;
    if (payment.kind === 'PAYMENT') paid += payment.amount;
    if (payment.kind === 'REFUND') refunded += payment.amount;
  }
  return { paid, refunded };
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

  const [total, orders, moneyOrders] = await Promise.all([
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
    prisma.order.findMany({
      where,
      take: 5000,
      select: {
        dueAmount: true,
        items: itemInclude,
        payments: { select: { kind: true, payeeKind: true, amount: true } },
      },
    }),
  ]);

  let received = 0;
  let refunded = 0;
  let receivable = 0;
  for (const order of moneyOrders) {
    const sums = leasingPaySums(order.payments);
    const slice = leasingReadyMoney({
      ownerAdminId: input.ownerAdminId,
      items: order.items,
      paidAmount: sums.paid,
      refundedAmount: sums.refunded,
      dueAmount: order.dueAmount,
    });
    received += slice.received;
    refunded += slice.refunded;
    receivable += slice.due;
  }

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
      received,
      refunded,
      net: received - refunded,
      receivable: Math.max(0, receivable),
    },
    rows: orders.map((order) => {
      const sums = leasingPaySums(order.payments);
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
