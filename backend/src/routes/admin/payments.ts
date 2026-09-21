import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { notFound } from '../../lib/errors.js';
import { leasingPayeeSums } from '../../lib/money.js';
import { isOwnerRole } from '../../lib/adminRoles.js';
import {
  isMixedLeasingResale,
  leasingResaleMoneyShare,
} from '../../lib/leasingAccess.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, param, validate } from '../../middleware/validate.js';
import { assertLeasingOrderMoneyWrite } from '../../modules/leasing/guards.js';
import { loadOrderTotals, PAYMENT_STATE_LABEL, paymentState } from '../../services/money.js';
import { cancelOrderItem, listPayments, recordPayment, serializePayment } from '../../services/payments.js';

/**
 * Төлбөрийн дэвтэр — /api/admin/orders/:id дээр залгагдана.
 * Мөнгө орсныг бүртгэх, буцаалт хийх, захиалгын мөр цуцлах.
 */
export const adminPaymentsRouter = Router({ mergeParams: true });

const idParams = z.object({ id: z.string().min(1) });

const methodEnum = z.enum(['BANK_TRANSFER', 'CASH', 'CARD', 'QPAY', 'OTHER']);

async function loadLiveOrder(orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true, isLeasing: true, payeeKind: true },
  });
  if (!order) throw notFound('Захиалга олдсонгүй.');
  return order;
}

/** Захиалгын төлбөрийн түүх ба одоогийн байдал. */
adminPaymentsRouter.get(
  '/',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const orderId = param(req, 'id');
    const { syncOrderStorageFee } = await import('../../services/storageFee.js');
    await syncOrderStorageFee(orderId);
    const order = await loadLiveOrder(orderId);
    const [payments, totals] = await Promise.all([
      listPayments(orderId),
      loadOrderTotals(orderId),
    ]);
    let scopedTotals = totals;
    let scopedPayments = payments;
    let mixedOwnership = false;
    let attributedMoney = false;
    let unallocatedPaid = 0;
    let unallocatedRefunded = 0;
    if (req.auth?.role === 'LEASING') {
      const items = await prisma.orderItem.findMany({
        where: { orderId },
        select: {
          qty: true,
          unitPrice: true,
          cancelledAt: true,
          round: { select: { ownerKind: true, ownerAdminId: true } },
        },
      });
      const leasingSums = leasingPayeeSums(
        payments.map((payment) => ({
          kind: payment.kind,
          payeeKind: payment.payeeKind ?? null,
          amount: payment.amount,
        })),
      );
      if (isMixedLeasingResale(order, items)) {
        mixedOwnership = true;
        attributedMoney = true;
        const share = leasingResaleMoneyShare({
          ownerAdminId: req.auth.sub,
          items,
          paidAmount: leasingSums.paid,
          refundedAmount: leasingSums.refunded,
          dueAmount: totals.dueAmount,
        });
        scopedTotals = {
          ...totals,
          subtotal: share.ownSubtotal,
          paidAmount: share.paidAmount,
          refundedAmount: share.refundedAmount,
          netPaid: share.paidAmount - share.refundedAmount,
          dueAmount: share.dueAmount,
          total: share.ownSubtotal + totals.storageFee + totals.cargoFee + totals.leasingFee,
        };
        unallocatedPaid = share.unallocatedPaid;
        unallocatedRefunded = share.unallocatedRefunded;
        scopedPayments = [];
      }
    }
    const state = paymentState(scopedTotals);

    res.json({
      data: {
        payments: scopedPayments.map(serializePayment),
        totals: {
          subtotal: scopedTotals.subtotal,
          deliveryFee: scopedTotals.deliveryFee,
          storageFee: scopedTotals.storageFee,
          cargoFee: scopedTotals.cargoFee,
          leasingFee: scopedTotals.leasingFee,
          total: scopedTotals.total,
          paidAmount: scopedTotals.paidAmount,
          refundedAmount: scopedTotals.refundedAmount,
          netPaid: scopedTotals.netPaid,
          dueAmount: scopedTotals.dueAmount,
          writtenOffAmount: scopedTotals.writtenOffAmount,
          unallocatedPaid,
          unallocatedRefunded,
        },
        paymentState: state,
        paymentStateLabel: PAYMENT_STATE_LABEL[state],
        maxRefundable: mixedOwnership && !isOwnerRole(req.auth?.role) ? 0 : Math.max(0, scopedTotals.netPaid),
        mixedOwnership,
        attributedMoney,
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

    const order = await assertLeasingOrderMoneyWrite(param(req, 'id'), {
      sub: req.auth?.sub ?? '',
      role: req.auth?.role,
    });

    const { payment, totals } = await recordPayment({
      orderId: order.id,
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

    const order = await assertLeasingOrderMoneyWrite(param(req, 'id'), {
      sub: req.auth?.sub ?? '',
      role: req.auth?.role,
    });

    const { payment, totals } = await recordPayment({
      orderId: order.id,
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
    const order =
      body.refund || req.auth?.role === 'LEASING'
        ? await assertLeasingOrderMoneyWrite(param(req, 'id'), {
            sub: req.auth?.sub ?? '',
            role: req.auth?.role,
          })
        : await loadLiveOrder(param(req, 'id'));

    const result = await cancelOrderItem({
      orderId: order.id,
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
