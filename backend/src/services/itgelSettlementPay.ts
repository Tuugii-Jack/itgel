import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { audit } from '../lib/audit.js';
import { AppError, badRequest, conflict, forbidden, isQpayTimeoutError, notFound } from '../lib/errors.js';
import { canViewAllSettlements } from '../lib/adminRoles.js';
import {
  planSettlementPayment,
  sameAllocation,
  encodeTimeIdCursor,
  decodeTimeIdCursor,
  type SettlementAllocation,
} from '../lib/settlementMoney.js';
import {
  cancelQpayInvoice,
  checkQpayInvoice,
  createQpayInvoice,
  getQpayInvoice,
  isQpayReady,
  listQpayInvoices,
  type QpayInvoice,
} from './qpay.js';
import { rememberQpayInvoice } from '../integrations/qpay/ledger.js';
import {
  invoiceFromPayload,
  serializeSettlementPayment,
  SETTLEMENT_LIVE_INCLUDE,
} from './itgelSettlementView.js';

type Tx = Prisma.TransactionClient;
const LOCKED_STATUSES = ['INVOICED', 'PENDING_BANK'] as const;
const SETTLEMENT_QPAY_TIMEOUT_MS = Math.min(
  120_000,
  Math.max(
    500,
    Number(process.env.SETTLEMENT_QPAY_TIMEOUT_MS || process.env.QPAY_INVOICE_TIMEOUT_MS || 20_000) || 20_000,
  ),
);

function assertOwner(ownerAdminId: string, actorAdminId: string | null, role: string | null) {
  if (canViewAllSettlements(role ?? undefined)) return;
  if (role === 'LEASING' && actorAdminId === ownerAdminId) return;
  throw forbidden('Энэ тооцоонд хандах эрхгүй.');
}

function senderInvoiceNoOf(paymentId: string) {
  return `ITGEL-${paymentId}`;
}

function isQpayHardFailure(error: unknown): boolean {
  if (isQpayTimeoutError(error)) return false;
  if (!(error instanceof AppError)) return false;
  const status = error.details && typeof error.details === 'object' && error.details
    ? Number((error.details as { qpayStatus?: number }).qpayStatus)
    : NaN;
  if (status === 409) return false;
  return Number.isFinite(status) && status >= 400 && status < 500;
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
      throw conflict('Зөвхөн төлөөгүй үлдэгдэлтэй тооцоог төлнө.');
    }
  }
  return rows;
}

export async function previewSettlementPayment(input: {
  settlementIds: string[];
  amount?: unknown;
  allocations?: SettlementAllocation[] | null;
  ownerAdminId?: string;
  role?: string;
}) {
  if (canViewAllSettlements(input.role) && !input.ownerAdminId) {
    throw badRequest('Эзэн сонгоно уу. Өөр эзний өрийг нэгтгэхгүй.');
  }
  const rows = await loadSettlementsForPay(input.settlementIds, input.ownerAdminId);
  const owners = new Set(rows.map((row) => row.ownerAdminId));
  if (owners.size !== 1) throw conflict('Нэг эзний тооцоог хамтад нь төлнө.');
  const remaining = rows.reduce((sum, row) => sum + row.remainingAmount, 0);
  const amount = input.amount === undefined || input.amount === null ? remaining : input.amount;
  const plan = planSettlementPayment(
    rows.map((row) => ({ id: row.id, remainingAmount: row.remainingAmount, confirmedAt: row.confirmedAt })),
    amount,
    input.allocations,
  );
  if (!plan.ok) throw badRequest(plan.message);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    ownerAdminId: [...owners][0]!,
    amount: plan.amount,
    remainingTotal: remaining,
    allocations: plan.allocations.map((line) => {
      const row = byId.get(line.settlementId)!;
      return {
        settlementId: row.id,
        orderId: row.sourceOrderId,
        orderCode: row.sourceOrderCode,
        productName: row.productName,
        remainingAmount: row.remainingAmount,
        amount: line.amount,
      };
    }),
  };
}

async function lockSettlementRows(tx: Tx, ids: string[]) {
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "ItgelSettlement" WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`,
  );
  return tx.itgelSettlement.findMany({ where: { id: { in: ids } } });
}

function allocationsOf(
  lines: { settlementId: string; amount: number }[],
): SettlementAllocation[] {
  return lines.map((line) => ({ settlementId: line.settlementId, amount: line.amount }));
}

export async function createSettlementPayment(input: {
  settlementIds: string[];
  method: 'QPAY' | 'BANK_TRANSFER';
  ownerAdminId?: string;
  actorAdminId: string;
  role: string;
  amount?: unknown;
  allocations?: SettlementAllocation[] | null;
  bankRef?: string | null;
  bankDate?: Date | null;
  receiptUrl?: string | null;
  note?: string | null;
}) {
  assertOwner(input.ownerAdminId ?? input.actorAdminId, input.actorAdminId, input.role);
  if (input.method === 'QPAY' && !isQpayReady('shop')) {
    throw conflict('Итгэлийн QPay одоогоор идэвхжээгүй.', { code: 'QPAY_NOT_READY' });
  }
  if (input.method === 'BANK_TRANSFER') {
    if (!input.bankRef?.trim()) throw conflict('Гүйлгээний лавлагаа оруулна уу.');
    if (!input.bankDate) throw conflict('Шилжүүлгийн огноо оруулна уу.');
  }

  if (canViewAllSettlements(input.role) && !input.ownerAdminId) {
    throw badRequest('Эзэн сонгоно уу. Өөр эзний өрийг нэгтгэхгүй.');
  }

  const uniqueIds = [...new Set(input.settlementIds)];
  const payment = await prisma.$transaction(async (tx) => {
    const rows = await lockSettlementRows(tx, uniqueIds);
    if (rows.length !== uniqueIds.length) throw notFound('Тооцоо олдсонгүй.');
    const owners = new Set(rows.map((row) => row.ownerAdminId));
    if (owners.size !== 1) throw conflict('Нэг эзний тооцоог хамтад нь төлнө.');
    const ownerAdminId = [...owners][0]!;
    if (input.ownerAdminId && input.ownerAdminId !== ownerAdminId) {
      throw conflict('Нэг эзний тооцоог хамтад нь төлнө.');
    }
    if (!canViewAllSettlements(input.role) && ownerAdminId !== input.actorAdminId) {
      throw forbidden('Энэ тооцоонд хандах эрхгүй.');
    }
    assertOwner(ownerAdminId, input.actorAdminId, input.role);

    const lockIds = [...new Set(rows.map((row) => row.lockPaymentId).filter(Boolean))] as string[];
    const remainingRows = rows.filter((row) => row.status === 'OPEN' && row.remainingAmount > 0 && !row.lockPaymentId);
    const lockedRows = rows.filter((row) => row.lockPaymentId);

    if (lockedRows.length > 0) {
      if (lockIds.length !== 1 || remainingRows.length > 0) {
        throw conflict('Эдгээр тооцоо өөр төлбөрт орсон байна.');
      }
      const existing = await tx.itgelSettlementPayment.findUnique({
        where: { id: lockIds[0]! },
        include: { lines: true },
      });
      if (!existing || existing.status !== 'PENDING' || existing.method !== input.method) {
        throw conflict('Эдгээр тооцоо өөр төлбөрт орсон байна.');
      }
      const remaining = rows.reduce((sum, row) => sum + row.remainingAmount, 0);
      const amount = input.amount === undefined || input.amount === null ? remaining : input.amount;
      const plan = planSettlementPayment(
        rows.map((row) => ({ id: row.id, remainingAmount: row.remainingAmount, confirmedAt: row.confirmedAt })),
        amount,
        input.allocations,
      );
      if (!plan.ok) throw badRequest(plan.message);
      if (existing.amount !== plan.amount || !sameAllocation(plan.allocations, allocationsOf(existing.lines))) {
        throw conflict('Идэвхтэй нэхэмжлэл өөр дүнтэй байна. Эхлээд цуцална уу.');
      }
      return existing;
    }

    for (const row of rows) {
      if (row.status !== 'OPEN' || row.remainingAmount <= 0) {
        throw conflict('Зөвхөн төлөөгүй үлдэгдэлтэй тооцоог төлнө.');
      }
      if (row.remainingAmount !== row.amount - row.paidAmount) {
        throw conflict('Тооцооны дүн өөрчлөгдсөн байна. Дахин сонгоно уу.');
      }
    }

    const remaining = rows.reduce((sum, row) => sum + row.remainingAmount, 0);
    const amount = input.amount === undefined || input.amount === null ? remaining : input.amount;
    const plan = planSettlementPayment(
      rows.map((row) => ({ id: row.id, remainingAmount: row.remainingAmount, confirmedAt: row.confirmedAt })),
      amount,
      input.allocations,
    );
    if (!plan.ok) throw badRequest(plan.message);

    const created = await tx.itgelSettlementPayment.create({
      data: {
        ownerAdminId,
        method: input.method,
        amount: plan.amount,
        status: 'PENDING',
        senderInvoiceNo: input.method === 'QPAY' ? undefined : null,
        bankRef: input.bankRef?.trim() || null,
        bankDate: input.bankDate ?? null,
        receiptUrl: input.receiptUrl?.trim() || null,
        claimedBy: `admin:${input.actorAdminId}`,
        note: input.note?.trim() || null,
        lines: {
          create: plan.allocations.map((line) => ({
            settlementId: line.settlementId,
            amount: line.amount,
          })),
        },
      },
    });

    if (input.method === 'QPAY') {
      await tx.itgelSettlementPayment.update({
        where: { id: created.id },
        data: { senderInvoiceNo: senderInvoiceNoOf(created.id) },
      });
    }

    const nextStatus = input.method === 'QPAY' ? 'INVOICED' : 'PENDING_BANK';
    const locked = await tx.itgelSettlement.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, status: 'OPEN', lockPaymentId: null },
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
          amount: plan.amount,
          settlementIds: rows.map((r) => r.id),
          allocations: plan.allocations,
        },
      },
      tx,
    );
    return created;
  });

  if (input.method !== 'QPAY') {
    return { payment, invoice: null as QpayInvoice | null, invoicePending: false, resumed: false };
  }

  return attachQpayInvoice(payment.id, `admin:${input.actorAdminId}`);
}

async function storedInvoiceOf(payment: {
  qpayInvoiceId: string | null;
  invoicePayload: unknown;
  amount: number;
}): Promise<QpayInvoice | null> {
  const existing = invoiceFromPayload(payment.invoicePayload);
  if (existing?.qrText && payment.qpayInvoiceId) return existing;
  if (payment.qpayInvoiceId && isQpayReady('shop')) {
    try {
      return await getQpayInvoice(payment.qpayInvoiceId, 'shop', payment.amount || existing?.amount || 0);
    } catch {
      /* GET батлагдаагүй/авахгүй бол хадгалсан stub */
    }
  }
  if (existing && payment.qpayInvoiceId) return existing;
  if (!payment.qpayInvoiceId) return existing;
  return {
    invoiceId: payment.qpayInvoiceId,
    qrText: existing?.qrText ?? '',
    qrImage: existing?.qrImage ?? null,
    shortUrl: existing?.shortUrl ?? null,
    urls: existing?.urls ?? [],
    amount: existing?.amount ?? payment.amount,
  };
}

async function persistSettlementInvoice(
  paymentId: string,
  invoice: QpayInvoice,
): Promise<void> {
  const linked = await prisma.itgelSettlementPayment.updateMany({
    where: {
      id: paymentId,
      OR: [{ qpayInvoiceId: null }, { qpayInvoiceId: invoice.invoiceId }],
    },
    data: {
      qpayInvoiceId: invoice.invoiceId,
      invoicePayload: invoice as unknown as Prisma.InputJsonValue,
    },
  });
  if (linked.count !== 1) {
    const current = await prisma.itgelSettlementPayment.findUnique({ where: { id: paymentId } });
    if (current?.qpayInvoiceId && current.qpayInvoiceId !== invoice.invoiceId) {
      throw conflict('Энэ төлбөрт өөр QPay нэхэмжлэл холбогдсон байна.');
    }
  }
  await rememberQpayInvoice(null, invoice.invoiceId, 'shop', prisma, {
    purpose: 'ITGEL_SETTLEMENT',
    amount: invoice.amount,
    settlementPaymentId: paymentId,
  });
}

async function lookupInvoiceBySender(senderInvoiceNo: string, amount: number): Promise<QpayInvoice | null> {
  const rows = await listQpayInvoices({ senderInvoiceNo }, 'shop');
  const open = rows.filter((row) => (row.status ?? 'OPEN').toUpperCase() !== 'CLOSED');
  const match = (open.length > 0 ? open : rows).find((row) => row.invoiceId) ?? null;
  if (!match) return null;
  try {
    return await getQpayInvoice(match.invoiceId, 'shop', amount || match.amount);
  } catch {
    return {
      invoiceId: match.invoiceId,
      qrText: '',
      qrImage: null,
      shortUrl: null,
      urls: [],
      amount: match.amount || amount,
    };
  }
}

async function recordOpenMoneyException(
  tx: Tx,
  data: {
    kind: string;
    settlementPaymentId?: string | null;
    qpayInvoiceId?: string | null;
    reference?: string | null;
    amount: number;
    note: string;
    actor: string;
  },
) {
  const existing = await tx.moneyException.findFirst({
    where: {
      status: 'OPEN',
      kind: data.kind,
      qpayInvoiceId: data.qpayInvoiceId ?? null,
      settlementPaymentId: data.settlementPaymentId ?? null,
      reference: data.reference ?? null,
    },
  });
  if (existing) return existing;
  try {
    return await tx.moneyException.create({
      data: {
        kind: data.kind,
        settlementPaymentId: data.settlementPaymentId ?? null,
        qpayInvoiceId: data.qpayInvoiceId ?? null,
        reference: data.reference ?? null,
        amount: data.amount,
        note: data.note,
        actor: data.actor,
      },
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002') {
      return existing;
    }
    throw error;
  }
}

export async function attachQpayInvoice(paymentId: string, actor: string) {
  const payment = await prisma.itgelSettlementPayment.findUnique({
    where: { id: paymentId },
    include: { lines: true },
  });
  if (!payment) throw notFound('Төлбөр олдсонгүй.');
  if (payment.method !== 'QPAY') throw conflict('Энэ төлбөр QPay биш.');
  if (payment.status !== 'PENDING') {
    return {
      payment,
      invoice: invoiceFromPayload(payment.invoicePayload),
      invoicePending: false,
      resumed: true,
    };
  }

  const existing = await storedInvoiceOf(payment);
  if (existing && payment.qpayInvoiceId) {
    if (!payment.invoicePayload && existing.qrText) {
      await persistSettlementInvoice(payment.id, existing);
    }
    return { payment, invoice: existing, invoicePending: false, resumed: true };
  }

  const senderInvoiceNo = payment.senderInvoiceNo || senderInvoiceNoOf(payment.id);
  await prisma.itgelSettlementPayment.updateMany({
    where: { id: payment.id, qpayInvoiceId: null },
    data: { senderInvoiceNo },
  });

  if (payment.invoiceAttemptAt) {
    const found = await lookupInvoiceBySender(senderInvoiceNo, payment.amount);
    if (found) {
      await persistSettlementInvoice(payment.id, found);
      return {
        payment: { ...payment, qpayInvoiceId: found.invoiceId, invoicePayload: found, senderInvoiceNo },
        invoice: found,
        invoicePending: false,
        resumed: true,
      };
    }
    return {
      payment: { ...payment, senderInvoiceNo },
      invoice: null,
      invoicePending: true,
      resumed: true,
    };
  }

  const claimed = await prisma.itgelSettlementPayment.updateMany({
    where: { id: payment.id, qpayInvoiceId: null, invoiceAttemptAt: null },
    data: { senderInvoiceNo, invoiceAttemptAt: new Date() },
  });
  if (claimed.count !== 1) {
    const found = await lookupInvoiceBySender(senderInvoiceNo, payment.amount).catch(() => null);
    if (found) {
      await persistSettlementInvoice(payment.id, found);
      return {
        payment: { ...payment, qpayInvoiceId: found.invoiceId, invoicePayload: found, senderInvoiceNo },
        invoice: found,
        invoicePending: false,
        resumed: true,
      };
    }
    return {
      payment: { ...payment, senderInvoiceNo },
      invoice: null,
      invoicePending: true,
      resumed: true,
    };
  }

  try {
    const invoice = await createQpayInvoice(
      {
        orderCode: `ITGEL-${payment.id.slice(-8).toUpperCase()}`,
        amount: payment.amount,
        description: `Лизинг Итгэлд ${payment.amount}₮`,
        senderInvoiceNo,
        timeoutMs: SETTLEMENT_QPAY_TIMEOUT_MS,
      },
      'shop',
    );
    await persistSettlementInvoice(payment.id, invoice);
    return {
      payment: { ...payment, qpayInvoiceId: invoice.invoiceId, invoicePayload: invoice, senderInvoiceNo },
      invoice,
      invoicePending: false,
      resumed: false,
    };
  } catch (error) {
    if (isQpayHardFailure(error)) {
      await unlockFailedInvoiceCreate(payment.id, actor);
      throw error;
    }
    const found = await lookupInvoiceBySender(senderInvoiceNo, payment.amount).catch(() => null);
    if (found) {
      await persistSettlementInvoice(payment.id, found);
      return {
        payment: { ...payment, qpayInvoiceId: found.invoiceId, invoicePayload: found, senderInvoiceNo },
        invoice: found,
        invoicePending: false,
        resumed: true,
      };
    }
    return {
      payment: { ...payment, senderInvoiceNo, invoiceAttemptAt: payment.invoiceAttemptAt ?? new Date() },
      invoice: null,
      invoicePending: true,
      resumed: true,
    };
  }
}

export async function reconcileUncertainSettlementInvoice(invoiceId: string): Promise<boolean> {
  const already = await prisma.itgelSettlementPayment.findFirst({
    where: { qpayInvoiceId: invoiceId },
    select: { id: true },
  });
  if (already) return true;

  const pending = await prisma.itgelSettlementPayment.findMany({
    where: {
      status: 'PENDING',
      method: 'QPAY',
      qpayInvoiceId: null,
      invoiceAttemptAt: { not: null },
    },
    orderBy: { invoiceAttemptAt: 'desc' },
    take: 30,
  });
  for (const payment of pending) {
    const sender = payment.senderInvoiceNo || senderInvoiceNoOf(payment.id);
    const found = await lookupInvoiceBySender(sender, payment.amount).catch(() => null);
    if (!found || found.invoiceId !== invoiceId) continue;
    await persistSettlementInvoice(payment.id, found);
    return true;
  }
  return false;
}

export async function recordUnmatchedSettlementPayment(input: {
  invoiceId: string;
  amount: number;
  actor: string;
  paymentRef?: string | null;
}) {
  await prisma.$transaction(async (tx) => {
    await recordOpenMoneyException(tx, {
      kind: 'SETTLEMENT_UNMATCHED',
      qpayInvoiceId: input.invoiceId,
      reference: input.paymentRef || input.invoiceId,
      amount: input.amount,
      note: `QPay invoice ${input.invoiceId} дээр ${input.amount}₮ орсон ч тооцооны төлбөр олдсонгүй.`,
      actor: input.actor,
    });
  });
}

async function unlockFailedInvoiceCreate(paymentId: string, actor: string) {
  await prisma.$transaction(async (tx) => {
    const current = await tx.itgelSettlementPayment.findUnique({ where: { id: paymentId } });
    if (!current || current.status !== 'PENDING' || current.qpayInvoiceId) return;
    const updated = await tx.itgelSettlementPayment.updateMany({
      where: { id: paymentId, status: 'PENDING', qpayInvoiceId: null },
      data: { status: 'SUPERSEDED' },
    });
    if (updated.count !== 1) return;
    await tx.itgelSettlement.updateMany({
      where: { lockPaymentId: paymentId, status: { in: [...LOCKED_STATUSES] } },
      data: { status: 'OPEN', lockPaymentId: null },
    });
    await audit(
      {
        actor,
        action: 'ITGEL_INVOICE_CREATE_FAILED',
        entity: 'ItgelSettlementPayment',
        entityId: paymentId,
        after: { unlocked: true },
      },
      tx,
    );
  });
}

export async function getPendingSettlementPayments(input: { ownerAdminId?: string }) {
  const rows = await prisma.itgelSettlementPayment.findMany({
    where: {
      status: 'PENDING',
      ...(input.ownerAdminId ? { ownerAdminId: input.ownerAdminId } : {}),
    },
    include: { lines: { include: { settlement: { include: SETTLEMENT_LIVE_INCLUDE } } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return rows;
}

export async function applySettlementQpayPayment(
  invoiceId: string,
  amount: number,
  actor: string,
  paymentRef?: string | null,
): Promise<boolean> {
  if (!Number.isSafeInteger(amount) || amount <= 0) return false;
  const reference = paymentRef?.trim() || invoiceId;
  return prisma.$transaction(async (tx) => {
    const payment = await tx.itgelSettlementPayment.findFirst({
      where: { qpayInvoiceId: invoiceId },
      include: { lines: true },
    });
    if (!payment) return false;
    if (payment.status === 'CONFIRMED') {
      if (amount > payment.amount) {
        await recordOpenMoneyException(tx, {
          kind: 'SETTLEMENT_OVERPAY',
          settlementPaymentId: payment.id,
          qpayInvoiceId: invoiceId,
          reference,
          amount: amount - payment.amount,
          note: `Итгэлийн тооцоо хаагдсаны дараа илүү QPay орлого. Invoice ${invoiceId}, гүйлгээ ${reference}.`,
          actor,
        });
      }
      return false;
    }
    if (payment.status === 'REJECTED' || payment.status === 'SUPERSEDED') {
      await recordOpenMoneyException(tx, {
        kind: 'SETTLEMENT_MISMATCH',
        settlementPaymentId: payment.id,
        qpayInvoiceId: invoiceId,
        reference,
        amount,
        note: `Тооцооны төлбөр ${payment.status} байхад QPay орсон. Invoice ${invoiceId}, гүйлгээ ${reference}, дүн ${amount}₮. Өрийг автоматаар хаагаагүй.`,
        actor,
      });
      return false;
    }
    if (amount !== payment.amount) {
      await recordOpenMoneyException(tx, {
        kind: 'SETTLEMENT_MISMATCH',
        settlementPaymentId: payment.id,
        qpayInvoiceId: invoiceId,
        reference,
        amount,
        note: `Нэхэмжлэл ${payment.amount}₮, орсон ${amount}₮. Invoice ${invoiceId}, гүйлгээ ${reference}.`,
        actor,
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
        await recordOpenMoneyException(tx, {
          kind: 'SETTLEMENT_MISMATCH',
          settlementPaymentId: payment.id,
          qpayInvoiceId: invoiceId,
          reference,
          amount,
          note: `Тооцооны төлбөр ${current.status} байхад QPay орсон. Invoice ${invoiceId}, гүйлгээ ${reference}, дүн ${amount}₮. Өрийг автоматаар хаагаагүй.`,
          actor,
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
    where: { id: paymentId, status: 'PENDING' },
    data: {
      status: 'CONFIRMED',
      confirmedBy: actor,
      confirmedAt: payment.confirmedAt ?? new Date(),
      confirmedAtSource: payment.confirmedAtSource ?? 'EVENT',
    },
  });
  if (updated.count !== 1) {
    const raced = await tx.itgelSettlementPayment.findUnique({ where: { id: paymentId } });
    if (raced?.status === 'CONFIRMED') return;
    throw conflict('Энэ төлбөр аль хэдийн шийдэгдсэн байна.');
  }

  for (const line of payment.lines) {
    const current = await tx.itgelSettlement.findUnique({ where: { id: line.settlementId } });
    if (
      !current ||
      current.lockPaymentId !== payment.id ||
      !LOCKED_STATUSES.includes(current.status as (typeof LOCKED_STATUSES)[number]) ||
      current.remainingAmount < line.amount
    ) {
      await recordOpenMoneyException(tx, {
        kind: 'SETTLEMENT_MISMATCH',
        settlementPaymentId: payment.id,
        amount: line.amount,
        note: `Тооцоо ${line.settlementId} хаагдах үед дүн зөрсөн.`,
        actor,
      });
      continue;
    }
    const remainingAmount = current.remainingAmount - line.amount;
    const paidAmount = current.paidAmount + line.amount;
    const closed = await tx.itgelSettlement.updateMany({
      where: {
        id: line.settlementId,
        lockPaymentId: payment.id,
        status: { in: [...LOCKED_STATUSES] },
        remainingAmount: current.remainingAmount,
      },
      data: {
        status: remainingAmount === 0 ? 'PAID' : 'OPEN',
        paidAmount,
        remainingAmount,
        lockPaymentId: null,
      },
    });
    if (closed.count !== 1) {
      await recordOpenMoneyException(tx, {
        kind: 'SETTLEMENT_MISMATCH',
        settlementPaymentId: payment.id,
        amount: line.amount,
        note: `Тооцоо ${line.settlementId} хаагдах үед дүн зөрсөн.`,
        actor,
      });
    }
  }

  await audit(
    {
      actor,
      action: 'ITGEL_PAYMENT_CONFIRMED',
      entity: 'ItgelSettlementPayment',
      entityId: payment.id,
      after: { amount: payment.amount, method: payment.method, confirmedAt: true },
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
  if (!payment) throw notFound('Төлбөр олдсонгүй.');
  let invoiceId = payment.qpayInvoiceId;
  if (!invoiceId) {
    const attached = await attachQpayInvoice(paymentId, actor);
    invoiceId = attached.payment.qpayInvoiceId ?? attached.invoice?.invoiceId ?? null;
    if (!invoiceId) {
      throw conflict('QPay нэхэмжлэл тодорхойгүй. Жагсаалтаас олдохгүй бол цуцалж шинэ төлбөр үүсгэнэ.', {
        code: 'QPAY_INVOICE_PENDING',
        paymentId,
      });
    }
  }
  if (!isQpayReady('shop')) throw conflict('QPay идэвхгүй.');
  const check = await checkQpayInvoice(invoiceId, 'shop');
  if (check.paid && check.paidAmount > 0) {
    await applySettlementQpayPayment(
      invoiceId,
      check.paidAmount,
      actor,
      check.paymentIds[0] ?? null,
    );
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

  let invoiceId = payment.qpayInvoiceId;
  if (!invoiceId && payment.method === 'QPAY') {
    const sender = payment.senderInvoiceNo || senderInvoiceNoOf(payment.id);
    const found = await lookupInvoiceBySender(sender, payment.amount).catch(() => null);
    if (found) {
      await persistSettlementInvoice(payment.id, found);
      invoiceId = found.invoiceId;
    }
  }

  if (invoiceId && isQpayReady('shop')) {
    const check = await checkQpayInvoice(invoiceId, 'shop').catch(() => null);
    if (check?.paid && check.paidAmount > 0) {
      const applied = await applySettlementQpayPayment(
        invoiceId,
        check.paidAmount,
        actor,
        check.paymentIds[0] ?? null,
      );
      if (applied) throw conflict('Төлбөр аль хэдийн орсон тул цуцлахгүй.');
      return;
    }
    await cancelQpayInvoice(invoiceId, { silent: true, kind: 'shop' });
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
        after: { invoiceId },
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
  confirmedDay?: boolean;
  cursor?: string;
  take?: number;
}) {
  const take = Math.min(Math.max(input.take ?? 50, 1), 100);
  const dateFilter =
    input.from || input.to
      ? input.confirmedDay
        ? {
            confirmedAt: { gte: input.from, lte: input.to },
          }
        : { createdAt: { gte: input.from, lte: input.to } }
      : {};
  const where: Prisma.ItgelSettlementPaymentWhereInput = {
    ...(input.ownerAdminId ? { ownerAdminId: input.ownerAdminId } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...dateFilter,
  };
  const cursor = decodeTimeIdCursor(input.cursor);
  const orderField = input.confirmedDay ? 'confirmedAt' : 'createdAt';
  const cursorWhere: Prisma.ItgelSettlementPaymentWhereInput | undefined = cursor
    ? {
        OR: [
          { [orderField]: { lt: cursor.at } },
          { [orderField]: cursor.at, id: { lt: cursor.id } },
        ],
      }
    : undefined;
  const [rows, agg] = await Promise.all([
    prisma.itgelSettlementPayment.findMany({
      where: cursorWhere ? { AND: [where, cursorWhere] } : where,
      include: {
        lines: { include: { settlement: { include: SETTLEMENT_LIVE_INCLUDE } } },
      },
      orderBy: input.confirmedDay
        ? [{ confirmedAt: 'desc' }, { id: 'desc' }]
        : [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    }),
    prisma.itgelSettlementPayment.aggregate({
      where,
      _count: true,
      _sum: { amount: true },
    }),
  ]);
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const last = page[page.length - 1];
  return {
    rows: page,
    nextCursor:
      hasMore && last
        ? encodeTimeIdCursor({
            at: (input.confirmedDay ? last.confirmedAt : last.createdAt) ?? last.createdAt,
            id: last.id,
          })
        : null,
    totals: {
      count: agg._count,
      amount: agg._sum.amount ?? 0,
    },
  };
}

export async function resumeSettlementPayment(paymentId: string, actor: string) {
  return attachQpayInvoice(paymentId, actor);
}

export { serializeSettlementPayment };
