import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { conflict, notFound } from '../../lib/errors.js';
import { endOfUbDay, parseUbDay, startOfUbDay } from '../../lib/date.js';
import { settlementOwnerFilter } from '../../lib/leasingAccess.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import {
  cancelOpenSettlementInvoice,
  createSettlementPayment,
  daySummary,
  listSettlementPayments,
  loadSettlementsForPay,
  serializeSettlement,
  serializeSettlementPayment,
  verifySettlementInvoice,
} from '../../services/itgelSettlement.js';
import { leasingReadySales, leasingReadyStockSummary } from '../../services/leasingReadyFinance.js';

export const leasingFinanceRouter = Router();

leasingFinanceRouter.get(
  '/ready/stock',
  asyncHandler(async (req, res) => {
    res.json({ data: await leasingReadyStockSummary(settlementOwnerFilter(req.auth!)) });
  }),
);

const salesQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  productId: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

leasingFinanceRouter.get(
  '/ready/sales',
  validate({ query: salesQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof salesQuery>>(req);
    const result = await leasingReadySales({ ownerAdminId: settlementOwnerFilter(req.auth!), ...q });
    res.json({ data: { totals: result.totals, rows: result.rows }, meta: result.meta });
  }),
);

leasingFinanceRouter.get(
  '/itgel/summary',
  validate({ query: z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }) }),
  asyncHandler(async (req, res) => {
    const dayRaw = query<{ day?: string }>(req).day;
    const day = dayRaw ? startOfUbDay(parseUbDay(dayRaw)) : new Date();
    res.json({ data: await daySummary({ ownerAdminId: settlementOwnerFilter(req.auth!), day }) });
  }),
);

leasingFinanceRouter.get(
  '/itgel/settlements',
  validate({
    query: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      status: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ from?: string; to?: string; status?: string }>(req);
    const rows = await prisma.itgelSettlement.findMany({
      where: {
        ...(settlementOwnerFilter(req.auth!) ? { ownerAdminId: settlementOwnerFilter(req.auth!) } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.from || q.to
          ? {
              confirmedAt: {
                gte: q.from ? startOfUbDay(parseUbDay(q.from)) : undefined,
                lte: q.to ? endOfUbDay(parseUbDay(q.to)) : undefined,
              },
            }
          : {}),
      },
      orderBy: { confirmedAt: 'desc' },
      take: 300,
    });
    res.json({ data: rows.map(serializeSettlement) });
  }),
);

const payBody = z.object({
  settlementIds: z.array(z.string().min(1)).min(1).max(50),
  method: z.enum(['QPAY', 'BANK_TRANSFER']),
  bankRef: z.string().trim().max(80).optional(),
  bankDate: z.string().min(8).max(40).optional(),
  receiptUrl: z.string().url().max(500).optional(),
  note: z.string().trim().max(300).optional(),
});

leasingFinanceRouter.post(
  '/itgel/pay',
  validate({ body: payBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof payBody>;
    const ownerFilter = settlementOwnerFilter(req.auth!);
    const rows = await loadSettlementsForPay(body.settlementIds, ownerFilter);
    const owners = new Set(rows.map((row) => row.ownerAdminId));
    if (owners.size !== 1) throw conflict('Нэг эзний тооцоог хамтад нь төлнө.');
    const ownerAdminId = [...owners][0]!;
    const result = await createSettlementPayment({
      settlementIds: body.settlementIds,
      method: body.method,
      ownerAdminId,
      actorAdminId: req.auth!.sub,
      role: req.auth!.role,
      bankRef: body.bankRef,
      bankDate: body.bankDate ? new Date(body.bankDate) : null,
      receiptUrl: body.receiptUrl,
      note: body.note,
    });
    res.status(201).json({
      data: {
        payment: {
          id: result.payment.id,
          amount: result.payment.amount,
          status: result.payment.status,
          method: result.payment.method,
          qpayInvoiceId: result.payment.qpayInvoiceId,
        },
        invoice: result.invoice,
      },
    });
  }),
);

leasingFinanceRouter.post(
  '/itgel/payments/:id/verify',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const ownerFilter = settlementOwnerFilter(req.auth!);
    const payment = await prisma.itgelSettlementPayment.findFirst({
      where: { id: req.params.id, ...(ownerFilter ? { ownerAdminId: ownerFilter } : {}) },
    });
    if (!payment) throw notFound('Төлбөр олдсонгүй.');
    const updated = await verifySettlementInvoice(payment.id, actorOf(req));
    res.json({ data: { id: updated.id, status: updated.status, amount: updated.amount } });
  }),
);

leasingFinanceRouter.post(
  '/itgel/payments/:id/cancel',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const ownerFilter = settlementOwnerFilter(req.auth!);
    const payment = await prisma.itgelSettlementPayment.findFirst({
      where: {
        id: req.params.id,
        status: 'PENDING',
        ...(ownerFilter ? { ownerAdminId: ownerFilter } : {}),
      },
    });
    if (!payment) throw notFound('Төлбөр олдсонгүй.');
    await cancelOpenSettlementInvoice(payment.id, actorOf(req));
    res.json({ data: { ok: true } });
  }),
);

leasingFinanceRouter.get(
  '/itgel/payments',
  asyncHandler(async (req, res) => {
    const rows = await listSettlementPayments({ ownerAdminId: settlementOwnerFilter(req.auth!) });
    res.json({ data: rows.map(serializeSettlementPayment) });
  }),
);
