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
  findOrderByQpayInvoice,
  isQpayReady,
  leasingQpayPublicStatus,
  qpayAccountForOrder,
  qpayPublicStatus,
  rememberQpayInvoice,
  type QpayAccountKind,
  type QpayInvoice,
} from '../../services/qpay.js';
import { buildLeasingPayPlan, leasingView, resolveInvoiceAmount } from '../../lib/leasing.js';
import { currentLeasingPayGaps } from '../../services/settings.js';

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
      kind: 'shop',
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
      kind: 'shop',
    });
  }),
);

publicQpayRouter.get(
  '/leasing-qpay/callback',
  asyncHandler(async (req, res) => {
    await qpayCallbackHandler({
      query: req.query as Record<string, unknown>,
      body: req.body,
      res,
      kind: 'leasing',
    });
  }),
);

publicQpayRouter.post(
  '/leasing-qpay/callback',
  asyncHandler(async (req, res) => {
    await qpayCallbackHandler({
      query: req.query as Record<string, unknown>,
      body: req.body,
      res,
      kind: 'leasing',
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
  validate({
    params: z.object({ code: z.string().min(3).max(20) }),
    body: z.object({ amount: z.coerce.number().int().min(1).optional() }).optional(),
  }),
  asyncHandler(async (req, res) => {
    const code = param(req, 'code').toUpperCase();
    const order = await prisma.order.findFirst({
      where: { code, deletedAt: null, customerId: req.auth!.sub },
      select: {
        id: true,
        code: true,
        status: true,
        dueAmount: true,
        subtotal: true,
        paidAmount: true,
        refundedAmount: true,
        storageFee: true,
        cargoFee: true,
        isLeasing: true,
        leasingFee: true,
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

    const kind = qpayAccountForOrder(order.isLeasing);
    if (!isQpayReady(kind)) {
      throw conflict(
        kind === 'leasing'
          ? 'Лизингийн QPay одоогоор идэвхжээгүй.'
          : 'QPay одоогоор идэвхжээгүй. Дансаар шилжүүлэх сонголтыг ашиглана уу.',
        {
          code: 'QPAY_NOT_READY',
          ...(kind === 'leasing' ? leasingQpayPublicStatus() : qpayPublicStatus()),
        },
      );
    }

    const leasing = leasingView(order);
    const requested = (req.body as { amount?: number } | undefined)?.amount;
    const plan = buildLeasingPayPlan({
      ...order,
      payGaps: await currentLeasingPayGaps(),
    });
    const resolved = resolveInvoiceAmount(leasing, requested, plan?.nextAmount);
    if (resolved.amount <= 0) {
      if (order.isLeasing && leasing.nextPayKind === 'PRINCIPAL') {
        throw conflict('Төлөх дүнгээ сонгоно уу.');
      }
      throw conflict('Энэ захиалгын төлбөр аль хэдийн бүрэн орсон байна.');
    }
    const amount = resolved.amount;

    if (order.qpayInvoiceId) {
      await rememberQpayInvoice(order.id, order.qpayInvoiceId, kind);
      await cancelQpayInvoice(order.qpayInvoiceId, { silent: true, kind });
    }

    const description =
      resolved.kind === 'FEE'
        ? `Лизинг шимтгэл ${order.code}`
        : resolved.kind === 'PRINCIPAL'
          ? `Лизинг үндсэн ${order.code}`
          : `Захиалга ${order.code}`;

    const invoice = await createQpayInvoice(
      {
        orderCode: order.code,
        amount,
        description,
      },
      kind,
    );

    await prisma.$transaction(async (tx) => {
      await rememberQpayInvoice(order.id, invoice.invoiceId, kind, tx);
      await tx.order.update({
        where: { id: order.id },
        data: {
          qpayInvoiceId: invoice.invoiceId,
          qpayInvoiceAt: new Date(),
        },
      });
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
        refundedAmount: true,
        subtotal: true,
        storageFee: true,
        cargoFee: true,
        isLeasing: true,
        leasingFee: true,
      },
    });
    if (!order) throw notFound('Захиалга олдсонгүй.');

    if (!order.qpayInvoiceId || !isQpayReady(qpayAccountForOrder(order.isLeasing))) {
      res.json({
        data: { paid: order.dueAmount <= 0, paidAmount: order.paidAmount, invoiceId: order.qpayInvoiceId },
      });
      return;
    }

    const kind = qpayAccountForOrder(order.isLeasing);
    const check = await checkQpayInvoice(order.qpayInvoiceId, kind);
    if (check.paid && check.paidAmount > 0) {
      await applyQpayPayment(
        order.id,
        order.qpayInvoiceId,
        check.paidAmount,
        check.paymentIds[0],
        kind === 'leasing' ? 'system:leasing-qpay' : 'system:qpay',
      );
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
  kind: QpayAccountKind;
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
  if (!resolvedInvoiceId && paymentId && isQpayReady(req.kind)) {
    try {
      const payment = await getQpayPayment(paymentId, req.kind);
      resolvedInvoiceId = payment.invoiceId;
    } catch (e) {
      console.error(`[qpay:${req.kind}] callback payment lookup failed`, e);
      req.res.status(503).send('RETRY');
      return;
    }
  }

  if (!resolvedInvoiceId) {
    req.res.status(200).send('SUCCESS');
    return;
  }

  if (!isQpayReady(req.kind)) {
    req.res.status(503).send('RETRY');
    return;
  }

  const order = await findOrderByQpayInvoice(resolvedInvoiceId);

  if (!order) {
    // The callback can arrive before the invoice-creation transaction commits.
    req.res.status(503).send('RETRY');
    return;
  }
  if (order.qpayAccount !== req.kind) {
    req.res.status(200).send('SUCCESS');
    return;
  }

  {
    try {
      const check = await checkQpayInvoice(resolvedInvoiceId, req.kind);
      if (check.paid && check.paidAmount > 0) {
        await applyQpayPayment(
          order.id,
          resolvedInvoiceId,
          check.paidAmount,
          check.paymentIds[0] ?? paymentId ?? undefined,
          req.kind === 'leasing' ? 'system:leasing-qpay' : 'system:qpay',
        );
      }
    } catch (e) {
      console.error(`[qpay:${req.kind}] callback verify failed`, e);
      req.res.status(503).send('RETRY');
      return;
    }
  }

  req.res.status(200).send('SUCCESS');
}
