import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound, forbidden } from '../lib/errors.js';
import { canViewAllSettlements } from '../lib/adminRoles.js';
import { endOfUbDay, startOfUbDay, ubDateString } from '../lib/date.js';
import { leasingView } from '../lib/leasing.js';
import { lockOrder, lockOrders } from '../lib/orderLock.js';
import { resolveAutoSettlementOwner } from '../lib/settlementOwner.js';
import {
  cancelQpayInvoice,
  checkQpayInvoice,
  createQpayInvoice,
  isQpayReady,
} from './qpay.js';
import { rememberQpayInvoice } from '../integrations/qpay/ledger.js';

type Tx = Prisma.TransactionClient;
type OwnerClient = Pick<Tx, 'setting' | 'adminUser'>;

const OPEN_STATUSES = ['OPEN'] as const;
const LOCKED_STATUSES = ['INVOICED', 'PENDING_BANK'] as const;

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

function assertOwner(ownerAdminId: string, actorAdminId: string | null, role: string | null) {
  if (canViewAllSettlements(role ?? undefined)) return;
  if (role === 'LEASING' && actorAdminId === ownerAdminId) return;
  throw forbidden('Энэ тооцоонд хандах эрхгүй.');
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
  });
  if (settlements.length === 0) {
    return items.map((item) => ({ ...item, itgel: null }));
  }
  const byItem = new Map(settlements.map((row) => [row.sourceOrderItemId, serializeSettlement(row)]));
  return items.map((item) => ({ ...item, itgel: byItem.get(item.id) ?? null }));
}

export function serializeSettlement(row: {
  id: string;
  ownerAdminId?: string;
  sourceOrderId: string;
  sourceOrderCode: string;
  customerId: string;
  customerName: string;
  productName: string;
  qty: number;
  unitPrice: number;
  amount: number;
  confirmedAt: Date;
  status: string;
  paidAmount: number;
  remainingAmount: number;
  readyTransferId: string | null;
  lockPaymentId: string | null;
}) {
  return {
    id: row.id,
    ownerAdminId: row.ownerAdminId ?? null,
    orderId: row.sourceOrderId,
    orderCode: row.sourceOrderCode,
    customerId: row.customerId,
    customerName: row.customerName.trim() || 'Нэргүй',
    productName: row.productName,
    qty: row.qty,
    unitPrice: row.unitPrice,
    amount: row.amount,
    confirmedAt: row.confirmedAt.toISOString(),
    day: ubDateString(row.confirmedAt),
    status: row.status,
    statusLabel: settlementStatusLabel(row.status),
    paidAmount: row.paidAmount,
    remainingAmount: row.remainingAmount,
    readyTransferId: row.readyTransferId,
    lockPaymentId: row.lockPaymentId,
  };
}

export function settlementStatusLabel(status: string): string {
  if (status === 'PAID') return 'Итгэлд төлсөн';
  if (status === 'PENDING_BANK') return 'Баталгаажуулалт хүлээж байна';
  if (status === 'INVOICED') return 'QPay хүлээгдэж байна';
  if (status === 'VOID') return 'Хүчингүй';
  return 'Итгэлд төлөөгүй';
}

export async function daySummary(input: {
  ownerAdminId?: string;
  day: Date;
}) {
  const from = startOfUbDay(input.day);
  const to = endOfUbDay(input.day);
  const where: Prisma.ItgelSettlementWhereInput = {
    status: { not: 'VOID' },
    ...(input.ownerAdminId ? { ownerAdminId: input.ownerAdminId } : {}),
  };
  const [todayRows, priorUnpaid] = await Promise.all([
    prisma.itgelSettlement.findMany({
      where: { ...where, confirmedAt: { gte: from, lte: to } },
      orderBy: { confirmedAt: 'asc' },
    }),
    prisma.itgelSettlement.aggregate({
      where: {
        ...where,
        status: { in: ['OPEN', 'INVOICED', 'PENDING_BANK'] },
        confirmedAt: { lt: from },
      },
      _sum: { remainingAmount: true },
      _count: true,
    }),
  ]);

  const amount = todayRows.reduce((sum, row) => sum + row.amount, 0);
  const paidAmount = todayRows.reduce((sum, row) => sum + row.paidAmount, 0);
  const remainingAmount = todayRows.reduce((sum, row) => sum + row.remainingAmount, 0);
  const unpaidToday = todayRows.filter((row) => row.status === 'OPEN');
  const unassigned = await listMissingSettlementOrders();
  const unassignedAmount = unassigned.reduce((sum, row) => sum + row.amount, 0);

  return {
    day: ubDateString(from),
    orderCount: new Set(todayRows.map((row) => row.sourceOrderId)).size,
    lineCount: todayRows.length,
    amount,
    paidAmount,
    remainingAmount,
    priorUnpaidAmount: priorUnpaid._sum.remainingAmount ?? 0,
    priorUnpaidCount: priorUnpaid._count,
    unassignedOrderCount: unassigned.length,
    unassignedAmount,
    lines: todayRows.map(serializeSettlement),
    unpaidTodayIds: unpaidToday.map((row) => row.id),
  };
}

export async function loadSettlementsForPay(ids: string[], ownerAdminId?: string) {
  const rows = await prisma.itgelSettlement.findMany({
    where: {
      id: { in: ids },
      ...(ownerAdminId ? { ownerAdminId } : {}),
    },
  });
  if (rows.length !== ids.length) throw notFound('Тооцоо олдсонгүй.');
  for (const row of rows) {
    if (row.status !== 'OPEN' || row.remainingAmount <= 0) {
      throw conflict('Зөвхөн төлөөгүй тооцоог бүтэн үлдэгдлээр нь төлнө.');
    }
  }
  return rows;
}

export async function createSettlementPayment(input: {
  settlementIds: string[];
  method: 'QPAY' | 'BANK_TRANSFER';
  ownerAdminId: string;
  actorAdminId: string;
  role: string;
  bankRef?: string | null;
  bankDate?: Date | null;
  receiptUrl?: string | null;
  note?: string | null;
}) {
  assertOwner(input.ownerAdminId, input.actorAdminId, input.role);
  if (input.method === 'QPAY' && !isQpayReady('shop')) {
    throw conflict('Итгэлийн QPay одоогоор идэвхжээгүй.', { code: 'QPAY_NOT_READY' });
  }
  if (input.method === 'BANK_TRANSFER') {
    if (!input.bankRef?.trim()) throw conflict('Гүйлгээний лавлагаа оруулна уу.');
    if (!input.bankDate) throw conflict('Шилжүүлгийн огноо оруулна уу.');
  }

  const payment = await prisma.$transaction(async (tx) => {
    const rows = await tx.itgelSettlement.findMany({
      where: {
        id: { in: input.settlementIds },
        ownerAdminId: input.ownerAdminId,
      },
    });
    if (rows.length !== input.settlementIds.length) throw notFound('Тооцоо олдсонгүй.');
    const amount = rows.reduce((sum, row) => sum + row.remainingAmount, 0);
    if (amount <= 0) throw conflict('Төлөх үлдэгдэл алга.');
    for (const row of rows) {
      if (row.status !== 'OPEN' || row.remainingAmount !== row.amount - row.paidAmount) {
        throw conflict('Тооцооны дүн өөрчлөгдсөн байна. Дахин сонгоно уу.');
      }
    }

    const created = await tx.itgelSettlementPayment.create({
      data: {
        ownerAdminId: input.ownerAdminId,
        method: input.method,
        amount,
        status: input.method === 'QPAY' ? 'PENDING' : 'PENDING',
        bankRef: input.bankRef?.trim() || null,
        bankDate: input.bankDate ?? null,
        receiptUrl: input.receiptUrl?.trim() || null,
        claimedBy: `admin:${input.actorAdminId}`,
        note: input.note?.trim() || null,
        lines: {
          create: rows.map((row) => ({
            settlementId: row.id,
            amount: row.remainingAmount,
          })),
        },
      },
    });

    const nextStatus = input.method === 'QPAY' ? 'INVOICED' : 'PENDING_BANK';
    const locked = await tx.itgelSettlement.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, status: 'OPEN' },
      data: { status: nextStatus, lockPaymentId: created.id },
    });
    if (locked.count !== rows.length) {
      throw conflict('Эдгээр тооцоо өөр төлбөрт орсон байна.');
    }

    await audit(
      {
        actor: `admin:${input.actorAdminId}`,
        action: 'ITGEL_PAYMENT_CREATE',
        entity: 'ItgelSettlementPayment',
        entityId: created.id,
        after: {
          method: input.method,
          amount,
          settlementIds: rows.map((r) => r.id),
        },
      },
      tx,
    );
    return created;
  });

  if (input.method !== 'QPAY') {
    return { payment, invoice: null };
  }

  const invoice = await createQpayInvoice(
    {
      orderCode: `ITGEL-${payment.id.slice(-8).toUpperCase()}`,
      amount: payment.amount,
      description: `Лизинг Итгэлд ${payment.amount}₮`,
    },
    'shop',
  );

  await prisma.$transaction(async (tx) => {
    await rememberQpayInvoice(null, invoice.invoiceId, 'shop', tx, {
      purpose: 'ITGEL_SETTLEMENT',
      amount: invoice.amount,
      settlementPaymentId: payment.id,
    });
    await tx.itgelSettlementPayment.update({
      where: { id: payment.id },
      data: { qpayInvoiceId: invoice.invoiceId },
    });
  });

  return { payment: { ...payment, qpayInvoiceId: invoice.invoiceId }, invoice };
}

export async function applySettlementQpayPayment(
  invoiceId: string,
  amount: number,
  actor: string,
): Promise<boolean> {
  if (!Number.isSafeInteger(amount) || amount <= 0) return false;
  return prisma.$transaction(async (tx) => {
    const payment = await tx.itgelSettlementPayment.findFirst({
      where: { qpayInvoiceId: invoiceId },
      include: { lines: true },
    });
    if (!payment) return false;
    if (payment.status === 'CONFIRMED') {
      if (amount > payment.amount) {
        await tx.moneyException.create({
          data: {
            kind: 'SETTLEMENT_OVERPAY',
            settlementPaymentId: payment.id,
            qpayInvoiceId: invoiceId,
            amount: amount - payment.amount,
            note: 'Итгэлийн тооцоо хаагдсаны дараа илүү QPay орлого.',
            actor,
          },
        });
      }
      return false;
    }
    if (payment.status === 'REJECTED' || payment.status === 'SUPERSEDED') {
      await tx.moneyException.create({
        data: {
          kind: 'SETTLEMENT_MISMATCH',
          settlementPaymentId: payment.id,
          qpayInvoiceId: invoiceId,
          amount,
          note: `Тооцооны төлбөр ${payment.status} байхад QPay орсон.`,
          actor,
        },
      });
      return false;
    }
    if (amount !== payment.amount) {
      await tx.moneyException.create({
        data: {
          kind: 'SETTLEMENT_MISMATCH',
          settlementPaymentId: payment.id,
          qpayInvoiceId: invoiceId,
          amount,
          note: `Нэхэмжлэл ${payment.amount}₮, орсон ${amount}₮.`,
          actor,
        },
      });
      return false;
    }
    try {
      await confirmSettlementPaymentTx(tx, payment.id, actor);
      return true;
    } catch (error) {
      const current = await tx.itgelSettlementPayment.findUnique({
        where: { id: payment.id },
        select: { status: true },
      });
      if (current?.status === 'CONFIRMED') return false;
      if (current?.status === 'REJECTED' || current?.status === 'SUPERSEDED') {
        await tx.moneyException.create({
          data: {
            kind: 'SETTLEMENT_MISMATCH',
            settlementPaymentId: payment.id,
            qpayInvoiceId: invoiceId,
            amount,
            note: `Тооцооны төлбөр ${current.status} байхад QPay орсон.`,
            actor,
          },
        });
        return false;
      }
      throw error;
    }
  });
}

async function confirmSettlementPaymentTx(tx: Tx, paymentId: string, actor: string) {
  const payment = await tx.itgelSettlementPayment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { lines: true },
  });
  if (payment.status === 'CONFIRMED') return;
  const updated = await tx.itgelSettlementPayment.updateMany({
    where: { id: paymentId, status: { in: ['PENDING'] } },
    data: { status: 'CONFIRMED', confirmedBy: actor },
  });
  if (updated.count !== 1) {
    const raced = await tx.itgelSettlementPayment.findUnique({ where: { id: paymentId } });
    if (raced?.status === 'CONFIRMED') return;
    throw conflict('Энэ төлбөр аль хэдийн шийдэгдсэн байна.');
  }

  for (const line of payment.lines) {
    const closed = await tx.itgelSettlement.updateMany({
      where: {
        id: line.settlementId,
        lockPaymentId: payment.id,
        status: { in: [...LOCKED_STATUSES] },
        remainingAmount: line.amount,
      },
      data: {
        status: 'PAID',
        paidAmount: { increment: line.amount },
        remainingAmount: 0,
      },
    });
    if (closed.count !== 1) {
      await tx.moneyException.create({
        data: {
          kind: 'SETTLEMENT_MISMATCH',
          settlementPaymentId: payment.id,
          amount: line.amount,
          note: `Тооцоо ${line.settlementId} хаагдах үед дүн зөрсөн.`,
          actor,
        },
      });
    }
  }

  await audit(
    {
      actor,
      action: 'ITGEL_PAYMENT_CONFIRMED',
      entity: 'ItgelSettlementPayment',
      entityId: payment.id,
      after: { amount: payment.amount, method: payment.method },
    },
    tx,
  );
}

export async function confirmBankSettlementPayment(input: {
  paymentId: string;
  actorAdminId: string;
}) {
  const payment = await prisma.itgelSettlementPayment.findUnique({
    where: { id: input.paymentId },
  });
  if (!payment) throw notFound('Төлбөр олдсонгүй.');
  if (payment.method !== 'BANK_TRANSFER') throw conflict('Зөвхөн дансны шилжүүлгийг батална.');
  await prisma.$transaction(async (tx) => {
    await confirmSettlementPaymentTx(tx, payment.id, `admin:${input.actorAdminId}`);
  });
}

export async function rejectBankSettlementPayment(input: {
  paymentId: string;
  actorAdminId: string;
  reason: string;
}) {
  const reason = input.reason.trim();
  if (!reason) throw conflict('Буцаах шалтгаан бичнэ үү.');
  await prisma.$transaction(async (tx) => {
    const payment = await tx.itgelSettlementPayment.findUnique({
      where: { id: input.paymentId },
      include: { lines: true },
    });
    if (!payment) throw notFound('Төлбөр олдсонгүй.');
    if (payment.status === 'CONFIRMED') throw conflict('Баталгаажсан төлбөрийг устгаж засахгүй.');
    const updated = await tx.itgelSettlementPayment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'REJECTED', rejectedReason: reason, confirmedBy: `admin:${input.actorAdminId}` },
    });
    if (updated.count !== 1) throw conflict('Энэ төлбөр аль хэдийн шийдэгдсэн байна.');
    await tx.itgelSettlement.updateMany({
      where: { lockPaymentId: payment.id, status: { in: [...LOCKED_STATUSES] } },
      data: { status: 'OPEN', lockPaymentId: null },
    });
    await audit(
      {
        actor: `admin:${input.actorAdminId}`,
        action: 'ITGEL_PAYMENT_REJECTED',
        entity: 'ItgelSettlementPayment',
        entityId: payment.id,
        after: { reason },
      },
      tx,
    );
  });
}

export async function verifySettlementInvoice(paymentId: string, actor: string) {
  const payment = await prisma.itgelSettlementPayment.findUnique({
    where: { id: paymentId },
  });
  if (!payment?.qpayInvoiceId) throw notFound('QPay нэхэмжлэл олдсонгүй.');
  if (!isQpayReady('shop')) throw conflict('QPay идэвхгүй.');
  const check = await checkQpayInvoice(payment.qpayInvoiceId, 'shop');
  if (check.paid && check.paidAmount > 0) {
    await applySettlementQpayPayment(payment.qpayInvoiceId, check.paidAmount, actor);
  }
  return prisma.itgelSettlementPayment.findUniqueOrThrow({ where: { id: paymentId } });
}

export async function cancelOpenSettlementInvoice(paymentId: string, actor: string) {
  const payment = await prisma.itgelSettlementPayment.findUnique({
    where: { id: paymentId },
  });
  if (!payment) throw notFound('Төлбөр олдсонгүй.');
  if (payment.status === 'CONFIRMED') throw conflict('Баталгаажсан нэхэмжлэлийг цуцлахгүй.');
  if (payment.status === 'REJECTED' || payment.status === 'SUPERSEDED') return;
  if (payment.qpayInvoiceId) {
    await cancelQpayInvoice(payment.qpayInvoiceId, { silent: true, kind: 'shop' });
  }
  await prisma.$transaction(async (tx) => {
    const current = await tx.itgelSettlementPayment.findUnique({
      where: { id: payment.id },
    });
    if (!current) throw notFound('Төлбөр олдсонгүй.');
    if (current.status === 'CONFIRMED') throw conflict('Баталгаажсан нэхэмжлэлийг цуцлахгүй.');
    if (current.status === 'REJECTED' || current.status === 'SUPERSEDED') return;
    const updated = await tx.itgelSettlementPayment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'SUPERSEDED' },
    });
    if (updated.count !== 1) {
      const raced = await tx.itgelSettlementPayment.findUnique({ where: { id: payment.id } });
      if (raced?.status === 'CONFIRMED') {
        throw conflict('Баталгаажсан нэхэмжлэлийг цуцлахгүй.');
      }
      return;
    }
    await tx.itgelSettlement.updateMany({
      where: { lockPaymentId: payment.id, status: { in: [...LOCKED_STATUSES] } },
      data: { status: 'OPEN', lockPaymentId: null },
    });
    await audit(
      {
        actor,
        action: 'ITGEL_INVOICE_CANCELLED',
        entity: 'ItgelSettlementPayment',
        entityId: payment.id,
        after: { invoiceId: payment.qpayInvoiceId },
      },
      tx,
    );
  });
}

export async function listSettlementPayments(input: {
  ownerAdminId?: string;
  status?: string;
  from?: Date;
  to?: Date;
}) {
  return prisma.itgelSettlementPayment.findMany({
    where: {
      ...(input.ownerAdminId ? { ownerAdminId: input.ownerAdminId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.from || input.to
        ? { createdAt: { gte: input.from, lte: input.to } }
        : {}),
    },
    include: {
      lines: { include: { settlement: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

export function serializeSettlementPayment(
  row: Prisma.ItgelSettlementPaymentGetPayload<{ include: { lines: { include: { settlement: true } } } }>,
) {
  return {
    id: row.id,
    method: row.method,
    amount: row.amount,
    status: row.status,
    qpayInvoiceId: row.qpayInvoiceId,
    bankRef: row.bankRef,
    bankDate: row.bankDate?.toISOString() ?? null,
    receiptUrl: row.receiptUrl,
    claimedBy: row.claimedBy,
    confirmedBy: row.confirmedBy,
    rejectedReason: row.rejectedReason,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    lines: row.lines.map((line) => ({
      amount: line.amount,
      settlement: serializeSettlement(line.settlement),
    })),
  };
}

void OPEN_STATUSES;
