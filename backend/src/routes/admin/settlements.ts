import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { parseUbDay, startOfUbDay } from '../../lib/date.js';
import { requireAdmin } from '../../middleware/auth.js';
import { asyncHandler, query, validate } from '../../middleware/validate.js';
import { unpaidAutoDeleteWhere } from '../../lib/unpaidCancel.js';
import { getSettings } from '../../services/settings.js';
import {
  assignMissingSettlementOwners,
  confirmBankSettlementPayment,
  daySummary,
  listMissingSettlementOrders,
  listSettlementPayments,
  rejectBankSettlementPayment,
  serializeSettlement,
  serializeSettlementPayment,
} from '../../services/itgelSettlement.js';

export const adminSettlementsRouter = Router();

adminSettlementsRouter.use(requireAdmin);

adminSettlementsRouter.get(
  '/missing-owners',
  asyncHandler(async (_req, res) => {
    const orders = await listMissingSettlementOrders();
    res.json({
      data: {
        orderCount: orders.length,
        amount: orders.reduce((sum, row) => sum + row.amount, 0),
        orders,
      },
    });
  }),
);

adminSettlementsRouter.post(
  '/missing-owners/assign',
  validate({
    body: z.object({
      ownerAdminId: z.string().min(1),
      orderIds: z.array(z.string().min(1)).min(1).max(200),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { ownerAdminId: string; orderIds: string[] };
    const result = await assignMissingSettlementOwners({
      ownerAdminId: body.ownerAdminId,
      orderIds: body.orderIds,
      actorAdminId: req.auth!.sub,
    });
    res.json({ data: result });
  }),
);

adminSettlementsRouter.get(
  '/summary',
  validate({
    query: z.object({
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      ownerAdminId: z.string().min(1).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ day?: string; ownerAdminId?: string }>(req);
    const day = q.day ? startOfUbDay(parseUbDay(q.day)) : new Date();
    res.json({ data: await daySummary({ ownerAdminId: q.ownerAdminId, day }) });
  }),
);

adminSettlementsRouter.get(
  '/settlements',
  validate({
    query: z.object({
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      ownerAdminId: z.string().min(1).optional(),
      status: z.string().optional(),
      q: z.string().trim().min(1).max(40).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ day?: string; ownerAdminId?: string; status?: string; q?: string }>(req);
    const dayRange = q.day
      ? {
          gte: startOfUbDay(parseUbDay(q.day)),
          lt: new Date(startOfUbDay(parseUbDay(q.day)).getTime() + 24 * 60 * 60 * 1000),
        }
      : undefined;
    const rows = await prisma.itgelSettlement.findMany({
      where: {
        ...(q.ownerAdminId ? { ownerAdminId: q.ownerAdminId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(dayRange ? { confirmedAt: dayRange } : {}),
        ...(q.q
          ? {
              OR: [
                { sourceOrderCode: { contains: q.q, mode: 'insensitive' } },
                { productName: { contains: q.q, mode: 'insensitive' } },
                { customerName: { contains: q.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { confirmedAt: 'desc' },
      take: 400,
    });
    res.json({ data: rows.map(serializeSettlement) });
  }),
);

adminSettlementsRouter.get(
  '/payments',
  validate({
    query: z.object({
      status: z.string().optional(),
      ownerAdminId: z.string().min(1).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ status?: string; ownerAdminId?: string }>(req);
    const rows = await listSettlementPayments({
      ownerAdminId: q.ownerAdminId,
      status: q.status,
    });
    res.json({ data: rows.map(serializeSettlementPayment) });
  }),
);

adminSettlementsRouter.post(
  '/payments/:id/confirm',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    await confirmBankSettlementPayment({
      paymentId: String(req.params.id),
      actorAdminId: req.auth!.sub,
    });
    res.json({ data: { ok: true } });
  }),
);

adminSettlementsRouter.post(
  '/payments/:id/reject',
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({ reason: z.string().trim().min(3).max(300) }),
  }),
  asyncHandler(async (req, res) => {
    await rejectBankSettlementPayment({
      paymentId: String(req.params.id),
      actorAdminId: req.auth!.sub,
      reason: (req.body as { reason: string }).reason,
    });
    res.json({ data: { ok: true } });
  }),
);

adminSettlementsRouter.get(
  '/exceptions',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.moneyException.findMany({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({
      data: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        orderId: row.orderId,
        amount: row.amount,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  }),
);

/** Read-only: төлөөгүй бэлэн захиалгад түгжигдсэн үлдэгдэл. Production өгөгдлийг өөрчлөхгүй. */
adminSettlementsRouter.get(
  '/unpaid-ready-holds',
  asyncHandler(async (_req, res) => {
    const settings = await getSettings();
    const cutoff = new Date(Date.now() - settings.unpaidCancelHours * 60 * 60 * 1000);
    const orders = await prisma.order.findMany({
      where: unpaidAutoDeleteWhere(cutoff),
      select: {
        id: true,
        code: true,
        createdAt: true,
        items: {
          where: { cancelledAt: null },
          select: {
            id: true,
            nameSnapshot: true,
            qty: true,
            stockHold: true,
            round: { select: { closeAt: true, id: true } },
          },
        },
      },
      take: 200,
    });
    const rows = orders.flatMap((order) =>
      order.items
        .filter((item) => item.round.closeAt === null)
        .map((item) => ({
          orderId: order.id,
          code: order.code,
          createdAt: order.createdAt.toISOString(),
          itemId: item.id,
          name: item.nameSnapshot,
          qty: item.qty,
          stockHold: item.stockHold,
          roundId: item.round.id,
        })),
    );
    res.json({
      data: {
        unpaidCancelHours: settings.unpaidCancelHours,
        count: rows.length,
        reservedQty: rows.filter((r) => r.stockHold === 'RESERVED').reduce((s, r) => s + r.qty, 0),
        consumedOrLegacyQty: rows
          .filter((r) => r.stockHold === 'NONE' || r.stockHold === 'CONSUMED')
          .reduce((s, r) => s + r.qty, 0),
        rows,
      },
    });
  }),
);

adminSettlementsRouter.get(
  '/operators',
  asyncHandler(async (_req, res) => {
    const users = await prisma.adminUser.findMany({
      where: { role: 'LEASING' },
      select: { id: true, name: true, email: true, isActive: true },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
    res.json({ data: users });
  }),
);
