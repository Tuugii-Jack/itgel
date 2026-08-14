import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { badRequest } from '../../lib/errors.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, param, validate } from '../../middleware/validate.js';
import {
  applyQpayPayment,
  cancelQpayInvoice,
  checkQpayInvoice,
  findOrderByQpayInvoice,
  getQpayPayment,
  listQpayPayments,
  qpayPublicStatus,
  reverseQpayPayment,
} from '../../services/qpay.js';

/**
 * Merchant-түвшин QPay — /api/admin/qpay
 * Cron/poll хийхгүй. Шалгах, жагсаах, цуцлах, буцаах нь гараар.
 */
export const adminQpayRouter = Router();

const invoiceIdBody = z.object({
  invoiceId: z.string().trim().min(1).max(80),
});

const paymentIdParams = z.object({
  paymentId: z.string().trim().min(1).max(80),
});

const invoiceIdParams = z.object({
  invoiceId: z.string().trim().min(1).max(80),
});

const listBody = z.object({
  objectType: z.string().trim().min(1).max(40).optional(),
  objectId: z.string().trim().min(1).max(80).optional(),
  startDate: z.string().trim().min(8).max(32).optional(),
  endDate: z.string().trim().min(8).max(32).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageLimit: z.coerce.number().int().min(1).max(100).optional(),
});

adminQpayRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ data: qpayPublicStatus() });
  }),
);

/** POST /v2/payment/check — зөвхөн гараар. Олдсон захиалгад дэвтэр бичнэ. */
adminQpayRouter.post(
  '/payments/check',
  validate({ body: invoiceIdBody }),
  asyncHandler(async (req, res) => {
    const { invoiceId } = req.body as z.infer<typeof invoiceIdBody>;
    const check = await checkQpayInvoice(invoiceId);
    const order = await findOrderByQpayInvoice(invoiceId);

    let recorded = false;
    if (order && check.paid && check.paidAmount > 0) {
      recorded = await applyQpayPayment(
        order.id,
        invoiceId,
        check.paidAmount,
        check.paymentIds[0],
        actorOf(req),
      );
    }

    res.json({
      data: {
        ...check,
        recorded,
        orderId: order?.id ?? null,
        orderCode: order?.code ?? null,
      },
    });
  }),
);

/** POST /v2/payment/list */
adminQpayRouter.post(
  '/payments/list',
  validate({ body: listBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof listBody>;
    if (!body.objectId && !(body.startDate && body.endDate)) {
      throw badRequest('objectId эсвэл startDate+endDate заавал байна.');
    }
    const list = await listQpayPayments(body);
    res.json({ data: list });
  }),
);

/** GET /v2/payment/{payment_id} */
adminQpayRouter.get(
  '/payments/:paymentId',
  validate({ params: paymentIdParams }),
  asyncHandler(async (req, res) => {
    const payment = await getQpayPayment(param(req, 'paymentId'));
    res.json({ data: payment });
  }),
);

/** DELETE /v2/payment/cancel/{payment_id} */
adminQpayRouter.delete(
  '/payments/:paymentId/cancel',
  validate({ params: paymentIdParams }),
  asyncHandler(async (req, res) => {
    const result = await reverseQpayPayment({
      paymentId: param(req, 'paymentId'),
      mode: 'cancel',
      actor: actorOf(req),
    });
    res.json({ data: result });
  }),
);

/** DELETE /v2/payment/refund/{payment_id} */
adminQpayRouter.delete(
  '/payments/:paymentId/refund',
  validate({ params: paymentIdParams }),
  asyncHandler(async (req, res) => {
    const result = await reverseQpayPayment({
      paymentId: param(req, 'paymentId'),
      mode: 'refund',
      actor: actorOf(req),
    });
    res.json({ data: result });
  }),
);

/** DELETE /v2/invoice/{invoice_id} */
adminQpayRouter.delete(
  '/invoices/:invoiceId',
  validate({ params: invoiceIdParams }),
  asyncHandler(async (req, res) => {
    const invoiceId = param(req, 'invoiceId');
    const order = await findOrderByQpayInvoice(invoiceId);
    await cancelQpayInvoice(invoiceId);

    if (order) {
      await prisma.order.update({
        where: { id: order.id },
        data: { qpayInvoiceId: null, qpayInvoiceAt: null },
      });
      await audit({
        actor: actorOf(req),
        action: 'QPAY_INVOICE_CANCELLED',
        entity: 'Order',
        entityId: order.id,
        after: { code: order.code, invoiceId },
      });
    }

    res.json({
      data: {
        invoiceId,
        orderId: order?.id ?? null,
        orderCode: order?.code ?? null,
      },
    });
  }),
);
