import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { notFound } from '../../lib/errors.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, param, validate } from '../../middleware/validate.js';
import { loadOrderTotals, PAYMENT_STATE_LABEL, paymentState } from '../../services/money.js';
import { cancelOrderItem, listPayments, recordPayment, serializePayment } from '../../services/payments.js';

/**
 * Төлбөрийн дэвтэр — /api/admin/orders/:id дээр залгагдана.
 * Мөнгө орсныг бүртгэх, буцаалт хийх, захиалгын мөр цуцлах.
 */
export const adminPaymentsRouter = Router({ mergeParams: true });

const idParams = z.object({ id: z.string().min(1) });

const methodEnum = z.enum(['BANK_TRANSFER', 'CASH', 'CARD', 'QPAY', 'OTHER']);

/** Захиалгын төлбөрийн түүх ба одоогийн байдал. */
adminPaymentsRouter.get(
  '/',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const orderId = param(req, 'id');
    const { syncOrderStorageFee } = await import('../../services/storageFee.js');
    await syncOrderStorageFee(orderId);

    const order = await prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: { id: true },
    });
    if (!order) throw notFound('Захиалга олдсонгүй.');

    const [payments, totals] = await Promise.all([
      listPayments(orderId),
      loadOrderTotals(orderId),
    ]);
    const state = paymentState(totals);

    res.json({
      data: {
        payments: payments.map(serializePayment),
        totals: {
          subtotal: totals.subtotal,
          deliveryFee: totals.deliveryFee,
          storageFee: totals.storageFee,
          total: totals.total,
          paidAmount: totals.paidAmount,
          refundedAmount: totals.refundedAmount,
          netPaid: totals.netPaid,
          dueAmount: totals.dueAmount,
        },
        paymentState: state,
        paymentStateLabel: PAYMENT_STATE_LABEL[state],
        maxRefundable: totals.netPaid,
      },
    });
  }),
);

/** Мөнгө орсныг бүртгэх. */
adminPaymentsRouter.post(
  '/',
  validate({
    params: idParams,
    body: z.object({
      amount: z.coerce.number().int().min(1),
      method: methodEnum.optional(),
      reference: z.string().trim().max(120).optional(),
      note: z.string().trim().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      amount: number;
      method?: z.infer<typeof methodEnum>;
      reference?: string;
      note?: string;
    };

    const { payment, totals } = await recordPayment({
      orderId: param(req, 'id'),
      kind: 'PAYMENT',
      amount: body.amount,
      method: body.method,
      reference: body.reference ?? null,
      note: body.note ?? null,
      actor: actorOf(req),
    });

    res.status(201).json({
      data: { payment: serializePayment(payment), totals },
    });
  }),
);

/** Буцаалт бүртгэх. Цэвэр орлогоос хэтэрвэл 409. */
adminPaymentsRouter.post(
  '/refunds',
  validate({
    params: idParams,
    body: z.object({
      amount: z.coerce.number().int().min(1),
      method: methodEnum.optional(),
      reference: z.string().trim().max(120).optional(),
      note: z.string().trim().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      amount: number;
      method?: z.infer<typeof methodEnum>;
      reference?: string;
      note?: string;
    };

    const { payment, totals } = await recordPayment({
      orderId: param(req, 'id'),
      kind: 'REFUND',
      amount: body.amount,
      method: body.method,
      reference: body.reference ?? null,
      note: body.note ?? null,
      actor: actorOf(req),
    });

    res.status(201).json({
      data: { payment: serializePayment(payment), totals },
    });
  }),
);

/** Захиалгын нэг мөрийг цуцлах. */
adminPaymentsRouter.post(
  '/items/:itemId/cancel',
  validate({
    params: idParams.extend({ itemId: z.string().min(1) }),
    body: z
      .object({
        reason: z.string().trim().max(300).optional(),
        /** Мөрийн дүнг автоматаар буцаах эсэх. Анхдагчаар тийм. */
        refund: z.boolean().default(true),
      })
      .default({ refund: true }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { reason?: string; refund: boolean };

    const result = await cancelOrderItem({
      orderId: param(req, 'id'),
      itemId: param(req, 'itemId'),
      reason: body.reason ?? null,
      refund: body.refund,
      actor: actorOf(req),
    });

    res.json({
      data: {
        totals: result.totals,
        refunded: result.refunded,
        orderCancelled: result.orderCancelled,
      },
    });
  }),
);
