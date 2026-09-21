import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { notFound } from '../../lib/errors.js';
import { endOfUbDay, parseUbDay, startOfUbDay } from '../../lib/date.js';
import { isOwnerRole } from '../../lib/adminRoles.js';
import { settlementOwnerFilter } from '../../lib/leasingAccess.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import {
  cancelOpenSettlementInvoice,
  createSettlementPayment,
  daySummary,
  getPendingSettlementPayments,
  listSettlementPayments,
  listSettlements,
  previewSettlementPayment,
  resumeSettlementPayment,
  serializePayments,
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

function ownerScope(req: { auth?: { sub: string; role: string } | null }, requested?: string) {
  const self = settlementOwnerFilter(req.auth!);
  if (self) return self;
  return requested?.trim() || undefined;
}

const dayQuery = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ownerAdminId: z.string().min(1).optional(),
});

leasingFinanceRouter.get(
  '/itgel/summary',
  validate({ query: dayQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof dayQuery>>(req);
    const day = q.day ? startOfUbDay(parseUbDay(q.day)) : new Date();
    res.json({ data: await daySummary({ ownerAdminId: ownerScope(req, q.ownerAdminId), day }) });
  }),
);

leasingFinanceRouter.get(
  '/itgel/operators',
  asyncHandler(async (req, res) => {
    if (!isOwnerRole(req.auth?.role)) {
      res.json({ data: [] });
      return;
    }
    const users = await prisma.adminUser.findMany({
      where: { role: 'LEASING' },
      select: { id: true, name: true, email: true, isActive: true },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
    res.json({ data: users });
  }),
);

leasingFinanceRouter.get(
  '/itgel/settlements',
  validate({
    query: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      status: z.string().optional(),
      q: z.string().trim().min(1).max(40).optional(),
      remaining: z.enum(['1', 'true']).optional(),
      ownerAdminId: z.string().min(1).optional(),
      cursor: z.string().min(1).optional(),
      take: z.coerce.number().int().min(1).max(100).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{
      from?: string;
      to?: string;
      status?: string;
      q?: string;
      remaining?: string;
      ownerAdminId?: string;
      cursor?: string;
      take?: number;
    }>(req);
    const page = await listSettlements({
      ownerAdminId: ownerScope(req, q.ownerAdminId),
      from: q.from ? startOfUbDay(parseUbDay(q.from)) : undefined,
      to: q.to ? endOfUbDay(parseUbDay(q.to)) : undefined,
      status: q.status,
      q: q.q,
      remainingOnly: Boolean(q.remaining),
      cursor: q.cursor,
      take: q.take,
    });
    res.json({
      data: page.rows,
      meta: { nextCursor: page.nextCursor, totals: page.totals },
    });
  }),
);

const allocationSchema = z.object({
  settlementId: z.string().min(1),
  amount: z.number().int(),
});

const payBody = z.object({
  settlementIds: z.array(z.string().min(1)).min(1).max(50),
  method: z.enum(['QPAY', 'BANK_TRANSFER']),
  amount: z.number().int().optional(),
  allocations: z.array(allocationSchema).max(50).optional(),
  ownerAdminId: z.string().min(1).optional(),
  bankRef: z.string().trim().max(80).optional(),
  bankDate: z.string().min(8).max(40).optional(),
  receiptUrl: z.string().url().max(500).optional(),
  note: z.string().trim().max(300).optional(),
});

leasingFinanceRouter.post(
  '/itgel/preview',
  validate({ body: payBody.pick({ settlementIds: true, amount: true, allocations: true, ownerAdminId: true }) }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      settlementIds: string[];
      amount?: number;
      allocations?: { settlementId: string; amount: number }[];
      ownerAdminId?: string;
    };
    const preview = await previewSettlementPayment({
      settlementIds: body.settlementIds,
      amount: body.amount,
      allocations: body.allocations,
      ownerAdminId: ownerScope(req, body.ownerAdminId),
      role: req.auth!.role,
    });
    res.json({ data: preview });
  }),
);

leasingFinanceRouter.post(
  '/itgel/pay',
  validate({ body: payBody }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof payBody>;
    const result = await createSettlementPayment({
      settlementIds: body.settlementIds,
      method: body.method,
      ownerAdminId: ownerScope(req, body.ownerAdminId),
      actorAdminId: req.auth!.sub,
      role: req.auth!.role,
      amount: body.amount,
      allocations: body.allocations,
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
          qpayInvoiceId: result.payment.qpayInvoiceId ?? null,
        },
        invoice: result.invoice,
        invoicePending: result.invoicePending,
      },
    });
  }),
);

leasingFinanceRouter.get(
  '/itgel/pending',
  validate({ query: z.object({ ownerAdminId: z.string().min(1).optional() }) }),
  asyncHandler(async (req, res) => {
    const q = query<{ ownerAdminId?: string }>(req);
    const rows = await getPendingSettlementPayments({
      ownerAdminId: ownerScope(req, q.ownerAdminId),
    });
    res.json({ data: await serializePayments(rows) });
  }),
);

leasingFinanceRouter.post(
  '/itgel/payments/:id/resume',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const ownerFilter = settlementOwnerFilter(req.auth!);
    const payment = await prisma.itgelSettlementPayment.findFirst({
      where: { id: req.params.id, ...(ownerFilter ? { ownerAdminId: ownerFilter } : {}) },
    });
    if (!payment) throw notFound('Төлбөр олдсонгүй.');
    const result = await resumeSettlementPayment(payment.id, actorOf(req));
    res.json({
      data: {
        payment: {
          id: result.payment.id,
          amount: result.payment.amount,
          status: result.payment.status,
          method: result.payment.method,
          qpayInvoiceId: result.payment.qpayInvoiceId ?? null,
        },
        invoice: result.invoice,
        invoicePending: result.invoicePending,
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
  validate({
    query: z.object({
      status: z.string().optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      ownerAdminId: z.string().min(1).optional(),
      cursor: z.string().min(1).optional(),
      take: z.coerce.number().int().min(1).max(100).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{
      status?: string;
      from?: string;
      to?: string;
      ownerAdminId?: string;
      cursor?: string;
      take?: number;
    }>(req);
    const confirmed = q.status === 'CONFIRMED';
    const page = await listSettlementPayments({
      ownerAdminId: ownerScope(req, q.ownerAdminId),
      status: q.status,
      from: q.from ? startOfUbDay(parseUbDay(q.from)) : undefined,
      to: q.to ? endOfUbDay(parseUbDay(q.to)) : undefined,
      confirmedDay: confirmed,
      cursor: q.cursor,
      take: q.take,
    });
    res.json({
      data: await serializePayments(page.rows),
      meta: { nextCursor: page.nextCursor, totals: page.totals },
    });
  }),
);
