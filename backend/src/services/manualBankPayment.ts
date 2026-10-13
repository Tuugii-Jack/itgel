import type { Payment } from '@prisma/client';
import { prisma } from '../prisma.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { lockOrder } from '../lib/orderLock.js';
import { computeTotals, leasingAccountDue, recalcOrderTotals, shopDueAmount, type OrderTotals } from './money.js';
import { confirmLeasingIfFeePaid, recordPaymentWithTotals } from './payments.js';

type Payee = 'SHOP' | 'LEASING';
type MoneyOrder = Parameters<typeof shopDueAmount>[0];

export function manualBankRecipients(order: MoneyOrder) {
  const totalDue = Math.max(0, computeTotals({ ...order, storageFee: order.storageFee ?? 0, cargoFee: order.cargoFee ?? 0, leasingFee: order.leasingFee ?? 0, writtenOffAmount: order.writtenOffAmount ?? 0 }).dueAmount);
  if (order.isLeasing || order.payeeKind === 'LEASING') {
    return [
      { payeeKind: 'LEASING' as const, label: 'Лизинг — шимтгэл, барааны төлбөр', dueAmount: Math.min(totalDue, leasingAccountDue(order)) },
      ...(order.isLeasing ? [{ payeeKind: 'SHOP' as const, label: 'Итгэл — карго, агуулах', dueAmount: Math.min(totalDue, shopDueAmount(order)) }] : []),
    ];
  }
  return [{ payeeKind: 'SHOP' as const, label: 'Итгэл — бараа, карго, агуулах', dueAmount: totalDue }];
}

/** A manual incoming payment is an ADMIN-only, reference-deduplicated ledger write. */
export async function recordManualBankPayment(input: {
  orderId: string; amount: number; reference: string; note?: string;
  payeeKind?: Payee; role: string; actorAdminId: string;
}): Promise<{ payment: Payment; totals: OrderTotals; replayed: boolean }> {
  if (input.role !== 'ADMIN') throw forbidden('Дансны орлогыг зөвхөн үндсэн ADMIN бүртгэнэ.');
  const reference = input.reference.trim().toUpperCase();
  if (!reference || reference.length > 120) throw badRequest('Банкны гүйлгээний давтагдашгүй дугаар оруулна уу.');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > 2_147_483_647) throw badRequest('Дүнг бүхэл төгрөгөөр зөв оруулна уу.');
  const result = await prisma.$transaction(async (tx) => {
    // Global reference lock prevents one bank receipt being applied to two orders concurrently.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`manual-bank:${reference}`}))`;
    await lockOrder(tx, input.orderId);
    const order = await tx.order.findUnique({ where: { id: input.orderId } });
    if (!order) throw notFound('Захиалга олдсонгүй.');
    const payee = input.payeeKind ?? (order.isLeasing || order.payeeKind === 'LEASING' ? undefined : 'SHOP');
    if (!payee) throw badRequest('Мөнгө орсон хүлээн авагчийг сонгоно уу.');
    const settlementReceipt = await tx.itgelSettlementPayment.findFirst({ where: { OR: [
      { method: 'BANK_TRANSFER', bankRef: { equals: reference, mode: 'insensitive' }, status: { in: ['PENDING', 'CONFIRMED'] } },
      { method: 'QPAY', OR: [{ qpayInvoiceId: { equals: reference, mode: 'insensitive' } }, { senderInvoiceNo: { equals: reference, mode: 'insensitive' } }] },
    ] } });
    if (settlementReceipt) throw conflict('Энэ гүйлгээ Итгэлийн тооцоонд аль хэдийн бүртгэгдсэн.');
    const existing = await tx.payment.findFirst({ where: { kind: 'PAYMENT', reference: { equals: reference, mode: 'insensitive' } } });
    if (existing) {
      if (existing.method !== 'BANK_TRANSFER') throw conflict('Энэ гүйлгээ QPay эсвэл өөр аргаар бүртгэгдсэн. Дансаар давхар нэмэхгүй.');
      const originalOrder = existing.orderId === order.id ? order : await tx.order.findUnique({ where: { id: existing.orderId } });
      const originalPayee = existing.payeeKind ?? (originalOrder?.isLeasing || originalOrder?.payeeKind === 'LEASING' ? 'LEASING' : 'SHOP');
      if (existing.orderId !== order.id || existing.amount !== input.amount || originalPayee !== payee) throw conflict('Энэ гүйлгээ өөр захиалга, дүн эсвэл хүлээн авагчид аль хэдийн бүртгэгдсэн.');
      return { payment: existing, totals: computeTotals(order), replayed: true };
    }
    if (order.deletedAt || order.status === 'CANCELLED' || order.debtClosedAt) throw conflict('Устсан, цуцалсан эсвэл өр хаасан захиалгад орлого нэмэхгүй.');
    const totals = await recalcOrderTotals(tx, order.id);
    const recipient = manualBankRecipients({ ...order, ...totals }).find((row) => row.payeeKind === payee);
    if (!recipient || input.amount > recipient.dueAmount) throw conflict('Сонгосон хүлээн авагчийн үлдэгдлээс их дүн бүртгэхгүй.', { maxAmount: recipient?.dueAmount ?? 0 });
    const recorded = await recordPaymentWithTotals(tx, {
      orderId: order.id, kind: 'PAYMENT', amount: input.amount, method: 'BANK_TRANSFER',
      reference, note: input.note, payeeKind: payee, actor: `admin:${input.actorAdminId}`,
    });
    return { ...recorded, replayed: false };
  });
  await confirmLeasingIfFeePaid(input.orderId, `admin:${input.actorAdminId}`);
  return result;
}
