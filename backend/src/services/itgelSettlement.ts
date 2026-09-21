import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';
import { endOfUbDay, startOfUbDay, ubDateString } from '../lib/date.js';
import { leasingView } from '../lib/leasing.js';
import { lockOrder, lockOrders } from '../lib/orderLock.js';
import { decodeTimeIdCursor, encodeTimeIdCursor } from '../lib/settlementMoney.js';
import { resolveAutoSettlementOwner } from '../lib/settlementOwner.js';
import {
  SETTLEMENT_LIVE_INCLUDE,
  displayStatusWhere,
  serializeSettlement,
  serializeSettlementPayment,
  settlementStatusLabel,
} from './itgelSettlementView.js';
import {
  applySettlementQpayPayment,
  attachQpayInvoice,
  cancelOpenSettlementInvoice,
  confirmBankSettlementPayment,
  createSettlementPayment,
  getPendingSettlementPayments,
  listSettlementPayments,
  loadSettlementsForPay,
  previewSettlementPayment,
  reconcileUncertainSettlementInvoice,
  recordUnmatchedSettlementPayment,
  rejectBankSettlementPayment,
  resumeSettlementPayment,
  verifySettlementInvoice,
} from './itgelSettlementPay.js';

type Tx = Prisma.TransactionClient;
type OwnerClient = Pick<Tx, 'setting' | 'adminUser'>;

const OPEN_STATUSES = ['OPEN'] as const;

/** Тохиргоонд заасан лизингийн админ. Хуучин snapshot/өр идэвхгүй id-г хадгална. */
export async function configuredLeasingSettlementAdminId(
  client: OwnerClient = prisma,
  opts?: { requireActive?: boolean },
): Promise<string | null> {
  const settings = await client.setting.findUnique({
    where: { id: 1 },
    select: { leasingSettlementAdminId: true },
  });
  const id = settings?.leasingSettlementAdminId?.trim() || null;
  if (!id) return null;
  const admin = await client.adminUser.findUnique({
    where: { id },
    select: { id: true, role: true, isActive: true },
  });
  if (!admin || admin.role !== 'LEASING') return null;
  if (opts?.requireActive && !admin.isActive) return null;
  return admin.id;
}

export async function snapshotLeasingOperatorAdminId(
  client: OwnerClient,
  isLeasing: boolean,
): Promise<string | null> {
  if (!isLeasing) return null;
  return configuredLeasingSettlementAdminId(client, { requireActive: true });
}

async function recordOwnerMissing(
  tx: Tx,
  order: { id: string; code: string; items: { cancelledAt: Date | null; qty: number; unitPrice: number }[] },
) {
  const existing = await tx.moneyException.findFirst({
    where: { orderId: order.id, kind: 'SETTLEMENT_OWNER_MISSING', status: 'OPEN' },
    select: { id: true },
  });
  if (existing) return;
  const amount = order.items
    .filter((item) => !item.cancelledAt && item.qty > 0)
    .reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  await tx.moneyException.create({
    data: {
      kind: 'SETTLEMENT_OWNER_MISSING',
      orderId: order.id,
      amount,
      note: `${order.code}: Итгэлд төлөх хариуцагч тохируулаагүй тул өр үүсгэсэнгүй.`,
      actor: 'system:leasing-confirm',
    },
  });
}

/**
 * Шимтгэл төлөгдөж захиалга CONFIRMED болсны дараа дуудна.
 * Checkout / шимтгэл хүлээгдэж буй үед тооцоо үүсгэхгүй.
 */
export async function createItgelSettlementsForOrder(orderId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findFirst({
      where: { id: orderId },
      include: {
        customer: { select: { id: true, name: true } },
        items: true,
      },
    });
    if (!order || !order.isLeasing) return 0;
    if (order.status === 'NEW' || order.status === 'CANCELLED') return 0;
    const view = leasingView(order);
    if (!view.feePaid) return 0;

    const openMissing = await tx.moneyException.findFirst({
      where: { orderId: order.id, kind: 'SETTLEMENT_OWNER_MISSING', status: 'OPEN' },
      select: { id: true },
    });
    const configuredActive = await configuredLeasingSettlementAdminId(tx, { requireActive: true });
    const ownerAdminId = resolveAutoSettlementOwner({
      snapshot: order.leasingOperatorAdminId,
      configuredActiveId: configuredActive,
      hasOpenOwnerMissing: Boolean(openMissing),
    });
    if (!ownerAdminId) {
      await recordOwnerMissing(tx, order);
      return 0;
    }
    if (!order.leasingOperatorAdminId) {
      await tx.order.update({
        where: { id: order.id },
        data: { leasingOperatorAdminId: ownerAdminId },
      });
    }
    return insertMissingSettlements(tx, order, ownerAdminId, 'system:leasing-confirm');
  });
}

function missingSettlementItems<T extends { id: string; cancelledAt: Date | null; qty: number }>(
  items: T[],
  have: Set<string>,
): T[] {
  return items.filter((item) => !item.cancelledAt && item.qty > 0 && !have.has(item.id));
}

async function insertMissingSettlements(
  tx: Tx,
  order: {
    id: string;
    code: string;
    customerId: string;
    confirmedAt: Date | null;
    customer: { name: string | null };
    items: {
      id: string;
      cancelledAt: Date | null;
      qty: number;
      unitPrice: number;
      productId: string;
      roundId: string;
      nameSnapshot: string;
    }[];
  },
  ownerAdminId: string,
  actor: string,
): Promise<number> {
  const existing = await tx.itgelSettlement.findMany({
    where: { sourceOrderItemId: { in: order.items.map((i) => i.id) } },
    select: { sourceOrderItemId: true },
  });
  const have = new Set(existing.map((row) => row.sourceOrderItemId));
  const rows = missingSettlementItems(order.items, have);
  if (rows.length === 0) return 0;

  const confirmedAt = order.confirmedAt ?? new Date();
  await tx.itgelSettlement.createMany({
    data: rows.map((item) => {
      const amount = item.unitPrice * item.qty;
      return {
        sourceOrderItemId: item.id,
        sourceOrderId: order.id,
        sourceOrderCode: order.code,
        customerId: order.customerId,
        customerName: order.customer.name?.trim() || '',
        ownerAdminId,
        productId: item.productId,
        roundId: item.roundId,
        productName: item.nameSnapshot,
        qty: item.qty,
        unitPrice: item.unitPrice,
        amount,
        confirmedAt,
        status: 'OPEN',
        paidAmount: 0,
        remainingAmount: amount,
      };
    }),
    skipDuplicates: true,
  });

  await audit(
    {
      actor,
      action: 'ITGEL_SETTLEMENT_CREATE',
      entity: 'Order',
      entityId: order.id,
      after: { code: order.code, lines: rows.length, ownerAdminId },
    },
    tx,
  );
  return rows.length;
}

export type MissingSettlementOrder = {
  id: string;
  code: string;
  customerName: string;
  confirmedAt: string | null;
  amount: number;
  itemCount: number;
  paidAmount: number;
  recordedMissing: boolean;
};

export async function listMissingSettlementOrders(): Promise<MissingSettlementOrder[]> {
  const [orders, missingExceptions] = await Promise.all([
    prisma.order.findMany({
      where: {
        isLeasing: true,
        deletedAt: null,
        status: { not: 'CANCELLED' },
        items: {
          some: { cancelledAt: null, qty: { gt: 0 }, itgelSettlement: { is: null } },
        },
      },
      include: {
        customer: { select: { name: true } },
        items: {
          where: { cancelledAt: null, qty: { gt: 0 }, itgelSettlement: { is: null } },
          select: { qty: true, unitPrice: true },
        },
      },
      orderBy: { confirmedAt: 'asc' },
      take: 400,
    }),
    prisma.moneyException.findMany({
      where: { kind: 'SETTLEMENT_OWNER_MISSING', status: 'OPEN', orderId: { not: null } },
      select: { orderId: true },
    }),
  ]);
  const recorded = new Set(missingExceptions.map((row) => row.orderId).filter((id): id is string => Boolean(id)));
  return orders
    .filter((order) => leasingView(order).feePaid)
    .map((order) => {
      const amount = order.items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
      return {
        id: order.id,
        code: order.code,
        customerName: order.customer.name?.trim() || 'Нэргүй',
        confirmedAt: order.confirmedAt?.toISOString() ?? null,
        amount,
        itemCount: order.items.length,
        paidAmount: order.paidAmount,
        recordedMissing: recorded.has(order.id),
      };
    })
    .filter((row) => row.amount > 0);
}

async function resolveOwnerMissingExceptions(tx: Tx, orderId: string, actor: string) {
  await tx.moneyException.updateMany({
    where: { orderId, kind: 'SETTLEMENT_OWNER_MISSING', status: 'OPEN' },
    data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: actor },
  });
}

/**
 * Үндсэн админ ил тод эзэн сонгож, эзэнгүй захиалгад тооцоог нэг удаа нөхнө.
 * Snapshot байвал түүнийг үлдээнэ. Хэрэглэгчийн төлбөрт хүрэхгүй.
 */
export async function assignMissingSettlementOwners(input: {
  orderIds: string[];
  ownerAdminId: string;
  actorAdminId: string;
}): Promise<{ created: number; orders: number }> {
  const orderIds = [...new Set(input.orderIds.filter(Boolean))].sort();
  if (orderIds.length === 0) throw badRequest('Захиалга сонгоно уу.');
  const admin = await prisma.adminUser.findUnique({
    where: { id: input.ownerAdminId },
    select: { id: true, role: true, isActive: true },
  });
  if (!admin || admin.role !== 'LEASING' || !admin.isActive) {
    throw badRequest('Идэвхтэй лизингийн админ сонгоно уу.');
  }
  const actor = `admin:${input.actorAdminId}`;

  return prisma.$transaction(async (tx) => {
    await lockOrders(tx, orderIds);
    let created = 0;
    let orders = 0;
    for (const orderId of orderIds) {
      const order = await tx.order.findFirst({
        where: { id: orderId, isLeasing: true, deletedAt: null, status: { not: 'CANCELLED' } },
        include: {
          customer: { select: { id: true, name: true } },
          items: true,
        },
      });
      if (!order) continue;
      if (!leasingView(order).feePaid) continue;
      const snapshot = order.leasingOperatorAdminId?.trim() || null;
      const ownerAdminId = snapshot || admin.id;
      if (!snapshot) {
        await tx.order.update({
          where: { id: order.id },
          data: { leasingOperatorAdminId: ownerAdminId },
        });
      }
      const lines = await insertMissingSettlements(tx, order, ownerAdminId, actor);
      created += lines;
      await resolveOwnerMissingExceptions(tx, order.id, actor);
      if (lines > 0) orders += 1;
      await audit(
        {
          actor,
          action: 'ITGEL_SETTLEMENT_ASSIGN_OWNER',
          entity: 'Order',
          entityId: order.id,
          after: {
            code: order.code,
            ownerAdminId,
            keptSnapshot: Boolean(snapshot),
            lines,
          },
        },
        tx,
      );
    }
    return { created, orders };
  });
}

export async function linkSettlementsToReadyTransfer(
  tx: Tx,
  orderItemIds: string[],
  readyTransferId: string,
): Promise<void> {
  if (orderItemIds.length === 0) return;
  await tx.itgelSettlement.updateMany({
    where: { sourceOrderItemId: { in: orderItemIds } },
    data: { readyTransferId },
  });
}

export async function attachItgelToItems<T extends { id: string }>(
  items: T[],
  orderId: string,
): Promise<(T & { itgel: ReturnType<typeof serializeSettlement> | null })[]> {
  const settlements = await prisma.itgelSettlement.findMany({
    where: { sourceOrderId: orderId },
    include: SETTLEMENT_LIVE_INCLUDE,
  });
  if (settlements.length === 0) {
    return items.map((item) => ({ ...item, itgel: null }));
  }
  const byItem = new Map(settlements.map((row) => [row.sourceOrderItemId, serializeSettlement(row)]));
  return items.map((item) => ({ ...item, itgel: byItem.get(item.id) ?? null }));
}

async function ownerNameMap(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.adminUser.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

export async function daySummary(input: {
  ownerAdminId?: string;
  day: Date;
}) {
  const from = startOfUbDay(input.day);
  const to = endOfUbDay(input.day);
  const owner = input.ownerAdminId ? { ownerAdminId: input.ownerAdminId } : {};
  const notVoid: Prisma.ItgelSettlementWhereInput = { status: { not: 'VOID' }, ...owner };
  const [
    createdRows,
    unpaidAgg,
    priorUnpaid,
    paidOnDay,
    paidUnknown,
    pendingBank,
    pendingQpay,
    unassigned,
  ] = await Promise.all([
    prisma.itgelSettlement.findMany({
      where: { ...notVoid, confirmedAt: { gte: from, lte: to } },
      include: SETTLEMENT_LIVE_INCLUDE,
      orderBy: { confirmedAt: 'asc' },
    }),
    prisma.itgelSettlement.aggregate({
      where: { ...notVoid, status: { in: ['OPEN', 'INVOICED', 'PENDING_BANK'] } },
      _sum: { remainingAmount: true },
      _count: true,
    }),
    prisma.itgelSettlement.aggregate({
      where: {
        ...notVoid,
        status: { in: ['OPEN', 'INVOICED', 'PENDING_BANK'] },
        confirmedAt: { lt: from },
      },
      _sum: { remainingAmount: true },
      _count: true,
    }),
    prisma.itgelSettlementPayment.aggregate({
      where: {
        ...owner,
        status: 'CONFIRMED',
        confirmedAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.itgelSettlementPayment.aggregate({
      where: {
        ...owner,
        status: 'CONFIRMED',
        confirmedAt: null,
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.itgelSettlementPayment.aggregate({
      where: { ...owner, status: 'PENDING', method: 'BANK_TRANSFER' },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.itgelSettlementPayment.aggregate({
      where: { ...owner, status: 'PENDING', method: 'QPAY' },
      _sum: { amount: true },
      _count: true,
    }),
    listMissingSettlementOrders(),
  ]);

  const names = await ownerNameMap(createdRows.map((row) => row.ownerAdminId));
  const lines = createdRows.map((row) =>
    serializeSettlement({ ...row, ownerName: names.get(row.ownerAdminId) ?? null }),
  );
  const createdOnDayAmount = createdRows.reduce((sum, row) => sum + row.amount, 0);
  const remainingAmount = createdRows.reduce((sum, row) => sum + row.remainingAmount, 0);
  const unassignedAmount = unassigned.reduce((sum, row) => sum + row.amount, 0);

  return {
    day: ubDateString(from),
    totalUnpaidRemaining: unpaidAgg._sum.remainingAmount ?? 0,
    totalUnpaidCount: unpaidAgg._count,
    createdOnDayAmount,
    createdOnDayCount: createdRows.length,
    createdOnDayOrders: new Set(createdRows.map((row) => row.sourceOrderId)).size,
    paidOnDayAmount: paidOnDay._sum.amount ?? 0,
    paidOnDayCount: paidOnDay._count,
    paidUnknownAmount: paidUnknown._sum.amount ?? 0,
    paidUnknownCount: paidUnknown._count,
    pendingBankAmount: pendingBank._sum.amount ?? 0,
    pendingBankCount: pendingBank._count,
    pendingQpayAmount: pendingQpay._sum.amount ?? 0,
    pendingQpayCount: pendingQpay._count,
    orderCount: new Set(createdRows.map((row) => row.sourceOrderId)).size,
    lineCount: createdRows.length,
    amount: createdOnDayAmount,
    paidAmount: paidOnDay._sum.amount ?? 0,
    remainingAmount,
    priorUnpaidAmount: priorUnpaid._sum.remainingAmount ?? 0,
    priorUnpaidCount: priorUnpaid._count,
    unassignedOrderCount: unassigned.length,
    unassignedAmount,
    lines,
    unpaidTodayIds: createdRows.filter((row) => row.status === 'OPEN').map((row) => row.id),
  };
}

export async function listSettlements(input: {
  ownerAdminId?: string;
  from?: Date;
  to?: Date;
  status?: string;
  q?: string;
  remainingOnly?: boolean;
  take?: number;
  cursor?: string;
}) {
  const search = input.q?.trim();
  const take = Math.min(Math.max(input.take ?? 50, 1), 100);
  const where: Prisma.ItgelSettlementWhereInput = {
      status: { not: 'VOID' },
      ...(input.ownerAdminId ? { ownerAdminId: input.ownerAdminId } : {}),
      ...(input.remainingOnly ? { remainingAmount: { gt: 0 } } : {}),
      ...(displayStatusWhere(input.status) ?? {}),
      ...(input.from || input.to
        ? {
            confirmedAt: {
              gte: input.from,
              lte: input.to,
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { sourceOrderCode: { contains: search, mode: 'insensitive' } },
              { productName: { contains: search, mode: 'insensitive' } },
              { customerName: { contains: search, mode: 'insensitive' } },
              { sourceOrder: { code: { contains: search, mode: 'insensitive' } } },
              { sourceOrder: { customer: { name: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
  };
  const cursor = decodeTimeIdCursor(input.cursor);
  const cursorWhere: Prisma.ItgelSettlementWhereInput | undefined = cursor
    ? {
        OR: [
          { confirmedAt: { gt: cursor.at } },
          { confirmedAt: cursor.at, id: { gt: cursor.id } },
        ],
      }
    : undefined;
  const [rows, agg] = await Promise.all([
    prisma.itgelSettlement.findMany({
      where: cursorWhere ? { AND: [where, cursorWhere] } : where,
      include: SETTLEMENT_LIVE_INCLUDE,
      orderBy: [{ confirmedAt: 'asc' }, { id: 'asc' }],
      take: take + 1,
    }),
    prisma.itgelSettlement.aggregate({
      where,
      _count: true,
      _sum: { remainingAmount: true, amount: true, paidAmount: true },
    }),
  ]);
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const names = await ownerNameMap(page.map((row) => row.ownerAdminId));
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => serializeSettlement({ ...row, ownerName: names.get(row.ownerAdminId) ?? null })),
    nextCursor: hasMore && last ? encodeTimeIdCursor({ at: last.confirmedAt, id: last.id }) : null,
    totals: {
      count: agg._count,
      remainingAmount: agg._sum.remainingAmount ?? 0,
      amount: agg._sum.amount ?? 0,
      paidAmount: agg._sum.paidAmount ?? 0,
    },
  };
}

export async function serializePayments(
  rows: Awaited<ReturnType<typeof listSettlementPayments>>['rows'],
) {
  const names = await ownerNameMap(rows.map((row) => row.ownerAdminId));
  return rows.map((row) =>
    serializeSettlementPayment(row, { ownerName: names.get(row.ownerAdminId) ?? null }),
  );
}

export {
  serializeSettlement,
  serializeSettlementPayment,
  settlementStatusLabel,
  applySettlementQpayPayment,
  attachQpayInvoice,
  cancelOpenSettlementInvoice,
  confirmBankSettlementPayment,
  createSettlementPayment,
  getPendingSettlementPayments,
  listSettlementPayments,
  loadSettlementsForPay,
  previewSettlementPayment,
  reconcileUncertainSettlementInvoice,
  recordUnmatchedSettlementPayment,
  rejectBankSettlementPayment,
  resumeSettlementPayment,
  verifySettlementInvoice,
};

void OPEN_STATUSES;
