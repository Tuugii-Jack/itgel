import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { conflict, notFound } from '../../lib/errors.js';
import { ipRateLimit } from '../../lib/rateLimit.js';
import { asyncHandler, param, validate } from '../../middleware/validate.js';
import { recordPayment } from '../../services/payments.js';
import {
  checkQpayInvoice,
  createQpayInvoice,
  getQpayInvoice,
  isQpayReady,
  qpayPublicStatus,
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
  urls: { name: string; description: string; link: string }[];
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
  ipRateLimit(15, 10 * 60 * 1000),
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
      where: { code, deletedAt: null },
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

    // Аль хэдийн invoice байвал төлөв шалгаад, төлөөгүй бол QR-ийг дахин өгнө.
    if (order.qpayInvoiceId) {
      const check = await checkQpayInvoice(order.qpayInvoiceId);
      if (check.paid && check.paidAmount > 0) {
        await applyQpayPayment(order.id, order.qpayInvoiceId, check.paidAmount, check.paymentIds[0]);
        throw conflict('Төлбөр аль хэдийн орсон байна. Хуудсыг шинэчилнэ үү.', {
          code: 'QPAY_ALREADY_PAID',
        });
      }
      const existing = await getQpayInvoice(order.qpayInvoiceId, order.dueAmount);
      res.json({
        data: serializeInvoice({
          ...existing,
          createdAt: order.qpayInvoiceAt,
        }),
      });
      return;
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
 * GET /api/orders/:code/qpay/status — төлбөр орсон эсэхийг шалгана (polling).
 */
publicQpayRouter.get(
  '/:code/qpay/status',
  ipRateLimit(60, 10 * 60 * 1000),
  validate({ params: z.object({ code: z.string().min(3).max(20) }) }),
  asyncHandler(async (req, res) => {
    const code = param(req, 'code').toUpperCase();
    const order = await prisma.order.findFirst({
      where: { code, deletedAt: null },
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
        data: {
          paid: true,
          paidAmount: order.paidAmount,
          invoiceId: order.qpayInvoiceId,
        },
      });
      return;
    }

    if (!order.qpayInvoiceId || !isQpayReady()) {
      res.json({
        data: {
          paid: false,
          paidAmount: 0,
          invoiceId: order.qpayInvoiceId,
          ready: isQpayReady(),
        },
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
 * Credential ирэхэд QPAY_CALLBACK_URL-д энэ замыг заана.
 * Биед/query-д invoice_id эсвэл qpay_payment_id ирж болно — payment/check-ээр баталгаажуулна.
 */
async function qpayCallbackHandler(req: {
  query: Record<string, unknown>;
  body: unknown;
  res: { status: (n: number) => { send: (b: string) => void; json: (b: unknown) => void } };
}): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const invoiceId =
    (typeof body.invoice_id === 'string' && body.invoice_id) ||
    (typeof req.query.invoice_id === 'string' && req.query.invoice_id) ||
    null;

  if (!invoiceId) {
    // QPay заримдаа зөвхөн payment_id илгээдэг — invoice-гүй бол SUCCESS буцаагаад орхино.
    req.res.status(200).send('SUCCESS');
    return;
  }

  if (!isQpayReady()) {
    req.res.status(200).send('SUCCESS');
    return;
  }

  const order = await prisma.order.findFirst({
    where: { qpayInvoiceId: invoiceId, deletedAt: null },
    select: { id: true, dueAmount: true },
  });

  if (order && order.dueAmount > 0) {
    try {
      const check = await checkQpayInvoice(invoiceId);
      if (check.paid && check.paidAmount > 0) {
        await applyQpayPayment(order.id, invoiceId, check.paidAmount, check.paymentIds[0]);
      }
    } catch (e) {
      console.error('[qpay] callback verify failed', e);
    }
  }

  // QPay spec: plain text SUCCESS
  req.res.status(200).send('SUCCESS');
}

/** QPay төлбөрийг дэвтэрт бүртгэнэ — давхар webhook/poll-д аюулгүй. */
async function applyQpayPayment(
  orderId: string,
  invoiceId: string,
  amount: number,
  paymentRef?: string,
): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { dueAmount: true, id: true },
  });
  if (!order || order.dueAmount <= 0) return;

  const payAmount = Math.min(amount, order.dueAmount);
  if (payAmount <= 0) return;

  // Ижил reference давхар бүртгэхгүй.
  const reference = paymentRef ?? `qpay:${invoiceId}`;
  const existing = await prisma.payment.findFirst({
    where: { orderId, reference, kind: 'PAYMENT' },
  });
  if (existing) return;

  await recordPayment({
    orderId,
    kind: 'PAYMENT',
    amount: payAmount,
    method: 'QPAY',
    reference,
    note: 'QPay автомат бүртгэл',
    actor: 'system:qpay',
  });

  await audit({
    actor: 'system:qpay',
    action: 'QPAY_PAID',
    entity: 'Order',
    entityId: orderId,
    after: { invoiceId, amount: payAmount, reference },
  });
}
