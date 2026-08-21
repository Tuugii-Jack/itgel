import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { conflict, notFound } from '../../lib/errors.js';
import { ipRateLimit } from '../../lib/rateLimit.js';
import { requireCustomer } from '../../middleware/auth.js';
import { asyncHandler, param, validate } from '../../middleware/validate.js';
import {
  applyQpayPayment,
  cancelQpayInvoice,
  checkQpayInvoice,
  createQpayInvoice,
  getQpayPayment,
  isQpayReady,
  qpayPublicStatus,
  type QpayInvoice,
} from '../../services/qpay.js';

export const publicQpayRouter = Router();

/**
 * Callback-ийг `/:code/...`-аас ӨМНӨ бүртгэнэ — эс бөгөөс code="qpay" гэж тайлбарлагдана.
 */
publicQpayRouter.get(
  '/qpay/callback',
  asyncHandler(async (req, res) => {
    await qpayCallbackHandler({
      query: req.query as Record<string, unknown>,
      body: req.body,
      res,
    });
  }),
);

publicQpayRouter.post(
  '/qpay/callback',
  asyncHandler(async (req, res) => {
    await qpayCallbackHandler({
      query: req.query as Record<string, unknown>,
      body: req.body,
      res,
    });
  }),
);

function serializeInvoice(input: {
  invoiceId: string;
  qrText: string;
  qrImage: string | null;
  shortUrl: string | null;
  urls: QpayInvoice["urls"];
  amount: number;
  createdAt: Date | null;
}) {
  return {
    invoiceId: input.invoiceId,
    qrText: input.qrText,
    qrImage: input.qrImage,
    shortUrl: input.shortUrl,
    urls: input.urls,
    amount: input.amount,
    createdAt: input.createdAt?.toISOString() ?? null,
  };
}

/**
 * POST /api/orders/:code/qpay/invoice — QPay нэхэмжлэл үүсгэх / дахин авах.
 * Credential байхгүй бол 409 QPAY_NOT_READY.
 */
publicQpayRouter.post(
  '/:code/qpay/invoice',
  requireCustomer,
  ipRateLimit(40, 10 * 60 * 1000),
  validate({ params: z.object({ code: z.string().min(3).max(20) }) }),
  asyncHandler(async (req, res) => {
    if (!isQpayReady()) {
      throw conflict(
        'QPay одоогоор идэвхжээгүй. Дансаар шилжүүлэх сонголтыг ашиглана уу.',
        { code: 'QPAY_NOT_READY', ...qpayPublicStatus() },
      );
    }

    const code = param(req, 'code').toUpperCase();
    const order = await prisma.order.findFirst({
      where: { code, deletedAt: null, customerId: req.auth!.sub },
      select: {
        id: true,
        code: true,
        status: true,
        dueAmount: true,
        subtotal: true,
        customerId: true,
        qpayInvoiceId: true,
        qpayInvoiceAt: true,
      },
    });
    if (!order) throw notFound('Захиалга олдсонгүй.');
    if (order.status === 'CANCELLED') {
      throw conflict('Цуцлагдсан захиалга дээр QPay үүсгэх боломжгүй.');
    }
    if (order.dueAmount <= 0) {
      throw conflict('Энэ захиалгын төлбөр аль хэдийн бүрэн орсон байна.');
    }

    if (order.qpayInvoiceId) {
      await cancelQpayInvoice(order.qpayInvoiceId, { silent: true });
    }

    const invoice = await createQpayInvoice({
      orderCode: order.code,
      amount: order.dueAmount,
      description: `Захиалга ${order.code}`,
    });

    await prisma.order.update({
      where: { id: order.id },
      data: {
        qpayInvoiceId: invoice.invoiceId,
        qpayInvoiceAt: new Date(),
      },
    });

    await audit({
      actor: `customer:${order.customerId}`,
      action: 'QPAY_INVOICE',
      entity: 'Order',
      entityId: order.id,
      after: { code: order.code, invoiceId: invoice.invoiceId, amount: invoice.amount },
    });

    res.status(201).json({
      data: serializeInvoice({
        ...invoice,
        createdAt: new Date(),
      }),
    });
  }),
);

/**
 * GET /api/orders/:code/qpay/status — зөвхөн манай дэвтэр (QPay-г poll хийхгүй).
 */
publicQpayRouter.get(
  '/:code/qpay/status',
  requireCustomer,
  ipRateLimit(60, 10 * 60 * 1000),
  validate({ params: z.object({ code: z.string().min(3).max(20) }) }),
  asyncHandler(async (req, res) => {
    const code = param(req, 'code').toUpperCase();
    const order = await prisma.order.findFirst({
      where: { code, deletedAt: null, customerId: req.auth!.sub },
      select: {
        dueAmount: true,
        qpayInvoiceId: true,
        paidAmount: true,
      },
    });
    if (!order) throw notFound('Захиалга олдсонгүй.');

    res.json({
      data: {
        paid: order.dueAmount <= 0,
        paidAmount: order.paidAmount,
        invoiceId: order.qpayInvoiceId,
      },
    });
  }),
);

/**
 * POST /api/orders/:code/qpay/verify — callback-ийн дараа гараар нэг удаа payment/check.
 */
publicQpayRouter.post(
  '/:code/qpay/verify',
  requireCustomer,
  ipRateLimit(12, 10 * 60 * 1000),
  validate({ params: z.object({ code: z.string().min(3).max(20) }) }),
  asyncHandler(async (req, res) => {
    const code = param(req, 'code').toUpperCase();
    const order = await prisma.order.findFirst({
      where: { code, deletedAt: null, customerId: req.auth!.sub },
      select: {
        id: true,
        dueAmount: true,
        qpayInvoiceId: true,
        paidAmount: true,
      },
    });
    if (!order) throw notFound('Захиалга олдсонгүй.');

    if (order.dueAmount <= 0) {
      res.json({
        data: { paid: true, paidAmount: order.paidAmount, invoiceId: order.qpayInvoiceId },
      });
      return;
    }

    if (!order.qpayInvoiceId || !isQpayReady()) {
      res.json({
        data: { paid: false, paidAmount: 0, invoiceId: order.qpayInvoiceId },
      });
      return;
    }

    const check = await checkQpayInvoice(order.qpayInvoiceId);
    if (check.paid && check.paidAmount > 0) {
      await applyQpayPayment(order.id, order.qpayInvoiceId, check.paidAmount, check.paymentIds[0]);
    }

    const fresh = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { dueAmount: true, paidAmount: true },
    });

    res.json({
      data: {
        paid: fresh.dueAmount <= 0,
        paidAmount: fresh.paidAmount,
        invoiceId: order.qpayInvoiceId,
      },
    });
  }),
);

/**
 * GET|POST /api/orders/qpay/callback — QPay callback.
 * Зөвхөн callback ирсний дараа POST /v2/payment/check дуудна.
 */
function pickId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function qpayCallbackHandler(req: {
  query: Record<string, unknown>;
  body: unknown;
  res: { status: (n: number) => { send: (b: string) => void; json: (b: unknown) => void } };
}): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const invoiceId =
    pickId(body.invoice_id) ||
    pickId(req.query.invoice_id) ||
    null;
  const paymentId =
    pickId(body.payment_id) ||
    pickId(body.qpay_payment_id) ||
    pickId(req.query.payment_id) ||
    pickId(req.query.qpay_payment_id) ||
    null;

  let resolvedInvoiceId = invoiceId;
  if (!resolvedInvoiceId && paymentId && isQpayReady()) {
    try {
      const payment = await getQpayPayment(paymentId);
      resolvedInvoiceId = payment.invoiceId;
    } catch (e) {
      console.error('[qpay] callback payment lookup failed', e);
    }
  }

  if (!resolvedInvoiceId) {
    req.res.status(200).send('SUCCESS');
    return;
  }

  if (!isQpayReady()) {
    req.res.status(200).send('SUCCESS');
    return;
  }

  const order = await prisma.order.findFirst({
    where: { qpayInvoiceId: resolvedInvoiceId, deletedAt: null },
    select: { id: true, dueAmount: true },
  });

  if (order && order.dueAmount > 0) {
    try {
      const check = await checkQpayInvoice(resolvedInvoiceId);
      if (check.paid && check.paidAmount > 0) {
        await applyQpayPayment(
          order.id,
          resolvedInvoiceId,
          check.paidAmount,
          check.paymentIds[0] ?? paymentId ?? undefined,
        );
      }
    } catch (e) {
      console.error('[qpay] callback verify failed', e);
    }
  }

  req.res.status(200).send('SUCCESS');
}
