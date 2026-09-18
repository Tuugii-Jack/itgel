import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { startOfUbDay, endOfUbDay, parseUbDay } from '../lib/date.js';
import { leasingOwnedRoundWhere } from '../lib/inventoryOwner.js';

export async function leasingReadyStockSummary(ownerAdminId: string) {
  const rounds = await prisma.productRound.findMany({
    where: { ...leasingOwnedRoundWhere(ownerAdminId), closeAt: null },
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
  ownerAdminId: string;
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
        round: { ownerKind: 'LEASING', ownerAdminId: input.ownerAdminId, closeAt: null },
        ...(input.productId ? { productId: input.productId } : {}),
      },
    },
    ...(from || to ? { createdAt: { gte: from, lte: to } } : {}),
    ...(input.status ? { status: input.status as Prisma.EnumOrderStatusFilter['equals'] } : {}),
  };

  const paymentWhere: Prisma.PaymentWhereInput = {
    order: where,
    payeeKind: 'LEASING',
  };

  const [total, orders, receivedAgg, refundedAgg, dueAgg] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        items: {
          include: {
            round: { select: { id: true, ownerAdminId: true, closeAt: true, ownerKind: true } },
          },
        },
        payments: { orderBy: { createdAt: 'asc' } },
      },
    }),
    prisma.payment.aggregate({
      where: { ...paymentWhere, kind: 'PAYMENT' },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { ...paymentWhere, kind: 'REFUND' },
      _sum: { amount: true },
    }),
    prisma.order.aggregate({
      where,
      _sum: { dueAmount: true },
    }),
  ]);

  const destRoundIds = [
    ...new Set(
      orders.flatMap((order) =>
        order.items
          .filter(
            (item) =>
              item.round.ownerKind === 'LEASING' &&
              item.round.ownerAdminId === input.ownerAdminId &&
              item.round.closeAt === null,
          )
          .map((item) => item.round.id),
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

  const received = receivedAgg._sum.amount ?? 0;
  const refunded = refundedAgg._sum.amount ?? 0;

  return {
    meta: { total, page: input.page, pageSize: input.pageSize, pages: Math.ceil(total / input.pageSize) },
    totals: {
      received,
      refunded,
      net: received - refunded,
      receivable: Math.max(0, dueAgg._sum.dueAmount ?? 0),
    },
    rows: orders.map((order) => {
      const ownItems = order.items.filter(
        (item) =>
          item.round.ownerKind === 'LEASING' &&
          item.round.ownerAdminId === input.ownerAdminId &&
          item.round.closeAt === null,
      );
      const sourceTransfer = ownItems
        .map((item) => transferByRound.get(item.round.id) ?? null)
        .find(Boolean);
      const leasingPaid = order.payments
        .filter((p) => p.kind === 'PAYMENT' && p.payeeKind === 'LEASING')
        .reduce((sum, p) => sum + p.amount, 0);
      const leasingRefunded = order.payments
        .filter((p) => p.kind === 'REFUND' && p.payeeKind === 'LEASING')
        .reduce((sum, p) => sum + p.amount, 0);
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
        items: ownItems.map((item) => ({
          id: item.id,
          name: item.nameSnapshot,
          qty: item.qty,
          unitPrice: item.unitPrice,
          total: item.unitPrice * item.qty,
          cancelled: item.cancelledAt != null,
          transferredAt: item.transferredAt?.toISOString() ?? null,
        })),
        paidAmount: leasingPaid,
        refundedAmount: leasingRefunded,
        dueAmount: order.dueAmount,
        paymentState:
          order.dueAmount < 0
            ? 'OVERPAID'
            : order.dueAmount === 0
              ? 'PAID'
              : leasingPaid > 0
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
