import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { conflict, notFound } from '../../lib/errors.js';
import { assertCanWriteLeasingOrderMoney } from '../../lib/leasing.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, param, validate } from '../../middleware/validate.js';
import {
  applyQpayPayment,
  cancelStoredQpayInvoice,
  checkQpayInvoice,
  isQpayReady,
  listQpayPayments,
  leasingQpayPublicStatus,
  qpayAccountForOrder,
  qpayPublicStatus,
  reverseQpayPayment,
} from '../../services/qpay.js';

/**
 * Захиалга дээрх QPay — /api/admin/orders/:id/qpay
 * Нэхэмжлэл шалгах, цуцлах, тухайн invoice-ийн төлбөрийн жагсаалт.
 */
export const adminOrderQpayRouter = Router({ mergeParams: true });

const idParams = z.object({ id: z.string().min(1) });

async function loadOrder(orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: {
      id: true,
      code: true,
      dueAmount: true,
      paidAmount: true,
      qpayInvoiceId: true,
      qpayInvoiceAt: true,
      isLeasing: true,
    },
  });
  if (!order) throw notFound('Захиалга олдсонгүй.');
  return order;
}

adminOrderQpayRouter.get(
  '/',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const order = await loadOrder(param(req, 'id'));
    const kind = qpayAccountForOrder(order.isLeasing);
    const status = kind === 'leasing' ? leasingQpayPublicStatus() : qpayPublicStatus();
    res.json({
      data: {
        ...status,
        invoiceId: order.qpayInvoiceId,
        invoiceAt: order.qpayInvoiceAt?.toISOString() ?? null,
        dueAmount: order.dueAmount,
        paidAmount: order.paidAmount,
        orderCode: order.code,
        account: kind,
      },
    });
  }),
);

/** Нэг удаа payment/check хийж, төлсөн бол дэвтэрт бичнэ. Poll хийхгүй. */
adminOrderQpayRouter.post(
  '/check',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const order = await loadOrder(param(req, 'id'));
    assertCanWriteLeasingOrderMoney(order.isLeasing, req.auth?.role);
    if (!order.qpayInvoiceId) throw conflict('QPay нэхэмжлэл алга.');
    const kind = qpayAccountForOrder(order.isLeasing);
    if (!isQpayReady(kind)) throw conflict('QPay одоогоор идэвхжээгүй.', { code: 'QPAY_NOT_READY' });

    const check = await checkQpayInvoice(order.qpayInvoiceId, kind);
    let recorded = false;
    if (check.paid && check.paidAmount > 0) {
      recorded = await applyQpayPayment(
        order.id,
        order.qpayInvoiceId,
        check.paidAmount,
        check.paymentIds[0],
        actorOf(req),
      );
    }

    res.json({
      data: {
        ...check,
        recorded,
        invoiceId: order.qpayInvoiceId,
      },
    });
  }),
);

adminOrderQpayRouter.get(
  '/payments',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const order = await loadOrder(param(req, 'id'));
    if (!order.qpayInvoiceId) {
      res.json({ data: { count: 0, rows: [] } });
      return;
    }
    const kind = qpayAccountForOrder(order.isLeasing);
    if (!isQpayReady(kind)) throw conflict('QPay одоогоор идэвхжээгүй.', { code: 'QPAY_NOT_READY' });

    const list = await listQpayPayments(
      {
        objectType: 'INVOICE',
        objectId: order.qpayInvoiceId,
      },
      kind,
    );
    res.json({ data: list });
  }),
);

adminOrderQpayRouter.delete(
  '/invoice',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const order = await loadOrder(param(req, 'id'));
    assertCanWriteLeasingOrderMoney(order.isLeasing, req.auth?.role);
    const result = await cancelStoredQpayInvoice(order.id, actorOf(req));
    res.json({ data: result });
  }),
);

const paymentParams = idParams.extend({ paymentId: z.string().trim().min(1).max(80) });

adminOrderQpayRouter.post(
  '/payments/:paymentId/cancel',
  validate({ params: paymentParams }),
  asyncHandler(async (req, res) => {
    const order = await loadOrder(param(req, 'id'));
    assertCanWriteLeasingOrderMoney(order.isLeasing, req.auth?.role);
    const result = await reverseQpayPayment({
      paymentId: param(req, 'paymentId'),
      mode: 'cancel',
      actor: actorOf(req),
      kind: qpayAccountForOrder(order.isLeasing),
    });
    res.json({ data: result });
  }),
);

adminOrderQpayRouter.post(
  '/payments/:paymentId/refund',
  validate({ params: paymentParams }),
  asyncHandler(async (req, res) => {
    const order = await loadOrder(param(req, 'id'));
    assertCanWriteLeasingOrderMoney(order.isLeasing, req.auth?.role);
    const result = await reverseQpayPayment({
      paymentId: param(req, 'paymentId'),
      mode: 'refund',
      actor: actorOf(req),
      kind: qpayAccountForOrder(order.isLeasing),
    });
    res.json({ data: result });
  }),
);
