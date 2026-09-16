import { audit } from '../../lib/audit.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { lockOrder } from '../../lib/orderLock.js';
import { prisma } from '../../prisma.js';
import { confirmLeasingIfFeePaid, recordPayment, recordPaymentWithTotals } from '../../services/payments.js';
import {
  cancelQpayInvoice,
  cancelQpayPayment,
  getQpayPayment,
  qpayAccountForOrder,
  refundQpayPayment,
  type QpayAccountKind,
  type QpayPaymentDetail,
} from './client.js';

/** Keep invoice ownership after replacement, cancellation, or a payment-method switch. */
export async function rememberQpayInvoice(
  orderId: string,
  invoiceId: string,
  account: QpayAccountKind,
  client: Pick<typeof prisma, 'qpayInvoice'> = prisma,
): Promise<void> {
  const invoice = await client.qpayInvoice.upsert({
    where: { id: invoiceId },
    create: { id: invoiceId, orderId, account },
    update: {},
  });
  if (invoice.orderId !== orderId || invoice.account !== account) {
    throw conflict('QPay нэхэмжлэл өөр захиалга эсвэл данстай холбогдсон байна.');
  }
}

/** amount is QPay's cumulative paid amount for this invoice, never the order balance. */
export async function applyQpayPayment(
  orderId: string,
  invoiceId: string,
  amount: number,
  paymentRef?: string,
  actor = 'system:qpay',
): Promise<boolean> {
  if (!Number.isSafeInteger(amount) || amount <= 0) return false;
  const recorded = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: { id: true, isLeasing: true, payeeKind: true },
    });
    if (!order) return false;
    const invoice = await tx.qpayInvoice.findUnique({ where: { id: invoiceId } });
    if (invoice && invoice.orderId !== orderId) throw conflict('QPay нэхэмжлэлийн захиалга зөрсөн.');
    if (!invoice) await rememberQpayInvoice(orderId, invoiceId, qpayAccountForOrder(order), tx);

    // Associate legacy records before calculating the already recorded cumulative amount.
    const reference = paymentRef ?? `qpay:${invoiceId}`;
    await tx.payment.updateMany({
      where: {
        orderId, kind: 'PAYMENT', method: 'QPAY', qpayInvoiceId: null,
        reference: { in: [...new Set([reference, `qpay:${invoiceId}`])] },
      },
      data: { qpayInvoiceId: invoiceId },
    });
    const previous = await tx.payment.aggregate({
      where: { orderId, kind: 'PAYMENT', qpayInvoiceId: invoiceId },
      _sum: { amount: true },
    });
    const payAmount = amount - (previous._sum.amount ?? 0);
    if (payAmount <= 0) return false;

    await recordPaymentWithTotals(tx, {
      orderId, kind: 'PAYMENT', amount: payAmount, method: 'QPAY',
      reference, qpayInvoiceId: invoiceId, note: 'QPay автомат бүртгэл', actor,
    });
    await audit({
      actor, action: 'QPAY_PAID', entity: 'Order', entityId: orderId,
      after: { invoiceId, amount: payAmount, reference },
    }, tx);
    return true;
  });
  if (recorded) await confirmLeasingIfFeePaid(orderId, actor);
  return recorded;
}

export async function findOrderByQpayInvoice(invoiceId: string) {
  if (!invoiceId) return null;
  const select = {
      id: true,
      code: true,
      dueAmount: true,
      paidAmount: true,
      qpayInvoiceId: true,
      qpayInvoiceAt: true,
      isLeasing: true,
      payeeKind: true,
      deletedAt: true,
    } as const;
  const invoice = await prisma.qpayInvoice.findUnique({
    where: { id: invoiceId },
    include: { order: { select } },
  });
  if (invoice) {
    if (invoice.order.deletedAt) return null;
    return { ...invoice.order, qpayAccount: invoice.account as QpayAccountKind };
  }
  const order = await prisma.order.findFirst({
    where: { qpayInvoiceId: invoiceId, deletedAt: null }, select,
  });
  return order ? { ...order, qpayAccount: qpayAccountForOrder(order) } : null;
}

/** Нэхэмжлэлийг QPay дээр цуцалж, захиалгаас id-г авна. */
export async function cancelStoredQpayInvoice(
  orderId: string,
  actor: string,
): Promise<{ invoiceId: string }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true, code: true, qpayInvoiceId: true, isLeasing: true, payeeKind: true },
  });
  if (!order) throw notFound('Захиалга олдсонгүй.');
  if (!order.qpayInvoiceId) throw conflict('QPay нэхэмжлэл алга.');

  await rememberQpayInvoice(order.id, order.qpayInvoiceId, qpayAccountForOrder(order));
  await cancelQpayInvoice(order.qpayInvoiceId, {
    kind: qpayAccountForOrder(order),
  });

  await prisma.order.updateMany({
    where: { id: order.id, qpayInvoiceId: order.qpayInvoiceId },
    data: { qpayInvoiceId: null, qpayInvoiceAt: null },
  });

  await audit({
    actor,
    action: 'QPAY_INVOICE_CANCELLED',
    entity: 'Order',
    entityId: order.id,
    after: { code: order.code, invoiceId: order.qpayInvoiceId },
  });

  return { invoiceId: order.qpayInvoiceId };
}

/**
 * QPay дээрх төлбөрийг буцаасны дараа дэвтэрт REFUND бичнэ.
 * QPay амжилттай болсны дараа дуудна — дэвтрийн алдааг 500 болгохгүй.
 */
export async function recordQpayRefund(input: {
  invoiceId: string | null;
  paymentId: string;
  amount: number;
  actor: string;
  note: string;
}): Promise<{ orderId: string | null; orderCode: string | null; recorded: boolean; error: string | null }> {
  if (!input.invoiceId) {
    return { orderId: null, orderCode: null, recorded: false, error: null };
  }

  const order = await findOrderByQpayInvoice(input.invoiceId);
  if (!order) {
    return { orderId: null, orderCode: null, recorded: false, error: null };
  }

  const reference = `qpay-refund:${input.paymentId}`;
  const existing = await prisma.payment.findFirst({
    where: { orderId: order.id, reference, kind: 'REFUND' },
  });
  if (existing) {
    return { orderId: order.id, orderCode: order.code, recorded: false, error: null };
  }

  const amount = Math.round(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { orderId: order.id, orderCode: order.code, recorded: false, error: null };
  }

  try {
    await recordPayment({
      orderId: order.id,
      kind: 'REFUND',
      amount,
      method: 'QPAY',
      reference,
      note: input.note,
      actor: input.actor,
    });
    return { orderId: order.id, orderCode: order.code, recorded: true, error: null };
  } catch (e) {
    const message = e instanceof AppError ? e.message : 'Дэвтэрт буцаалт бичиж чадсангүй.';
    return { orderId: order.id, orderCode: order.code, recorded: false, error: message };
  }
}

/** QPay дээр төлбөр цуцлах/буцаах, олдвол дэвтэрт REFUND бичнэ. */
export async function reverseQpayPayment(input: {
  paymentId: string;
  mode: 'cancel' | 'refund';
  actor: string;
  kind?: QpayAccountKind;
}): Promise<{
  payment: QpayPaymentDetail;
  recorded: boolean;
  orderId: string | null;
  orderCode: string | null;
  ledgerError: string | null;
}> {
  const kind = input.kind ?? 'shop';
  const payment = await getQpayPayment(input.paymentId, kind);
  if (input.mode === 'cancel') await cancelQpayPayment(input.paymentId, kind);
  else await refundQpayPayment(input.paymentId, kind);

  const ledger = await recordQpayRefund({
    invoiceId: payment.invoiceId,
    paymentId: input.paymentId,
    amount: payment.amount,
    actor: input.actor,
    note: input.mode === 'cancel' ? 'QPay төлбөр цуцалсан' : 'QPay буцаалт',
  });

  return {
    payment,
    recorded: ledger.recorded,
    orderId: ledger.orderId,
    orderCode: ledger.orderCode,
    ledgerError: ledger.error,
  };
}
