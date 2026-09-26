import { prisma } from '../../prisma.js';
import { endOfUbDay, parseUbDay, startOfUbDay, ubDateString } from '../../lib/date.js';
import type { AdminRoleName } from '../../lib/adminRoles.js';
import { canAccessLeasing, canAccessStaff, canViewAllSettlements, canWriteShop } from '../../lib/adminRoles.js';
import { SHOP_STAFF_ORDER_WHERE } from '../../lib/leasing.js';
import { buildLeasingPayPlan } from '../../lib/leasing.js';
import { pickableQtyOf } from '../../lib/itemQty.js';
import { qtyByBatchIds } from '../batches/list.js';
import { daySummary } from '../../services/itgelSettlement.js';
import { currentLeasingPayGaps } from '../../services/settings.js';

export type TodayCardKey =
  | 'due_today'
  | 'collected_today'
  | 'unpaid_itgel'
  | 'arrived_unhanded'
  | 'short_cargo'
  | 'unlinked_batch'
  | 'money_exception'
  | 'sms_failed'
  | 'sms_unknown';

export type TodayCard = {
  key: TodayCardKey;
  label: string;
  count: number;
  amount: number | null;
  paidAmount?: number | null;
  remainingAmount?: number | null;
  href: string;
};

function smsChannelFor(portal: 'shop' | 'leasing'): 'shop' | 'leasing' {
  return portal;
}

export async function loadTodayWork(input: {
  role: AdminRoleName;
  actorId: string;
  ownerAdminId?: string | null;
  day?: string | null;
  portal: 'shop' | 'leasing';
}): Promise<{ day: string; cards: TodayCard[] }> {
  const day = input.day ? parseUbDay(input.day) : new Date();
  const from = startOfUbDay(day);
  const to = endOfUbDay(day);
  const shop = input.portal === 'shop' && canAccessStaff(input.role);
  const leasing = input.portal === 'leasing' && canAccessLeasing(input.role);
  const ownerFilter =
    input.role === 'OWNER' && input.ownerAdminId?.trim()
      ? input.ownerAdminId.trim()
      : input.role === 'LEASING'
        ? input.actorId
        : undefined;
  const smsChannel = smsChannelFor(input.portal);
  const gaps = leasing ? await currentLeasingPayGaps() : [];

  const tasks: Promise<TodayCard | null>[] = [];

  if (leasing) {
    tasks.push(
      (async () => {
        const orders = await prisma.order.findMany({
          where: {
            deletedAt: null,
            isLeasing: true,
            status: { not: 'CANCELLED' },
            dueAmount: { gt: 0 },
            debtClosedAt: null,
          },
          select: {
            createdAt: true,
            subtotal: true,
            leasingFee: true,
            paidAmount: true,
            refundedAmount: true,
            isLeasing: true,
          },
        });
        let scheduled = 0;
        let paid = 0;
        let remaining = 0;
        let count = 0;
        for (const order of orders) {
          const plan = buildLeasingPayPlan({ ...order, payGaps: gaps });
          const steps = plan?.steps.filter((s) => s.status === 'due_today') ?? [];
          if (steps.length === 0) continue;
          count += 1;
          for (const step of steps) {
            scheduled += step.amount;
            paid += step.paidAmount;
            remaining += step.remaining;
          }
        }
        return {
          key: 'due_today' as const,
          label: 'Өнөөдөр төлөгдөх ёстой',
          count,
          amount: scheduled,
          paidAmount: paid,
          remainingAmount: remaining,
          href: '/workspace/leasing?goods=pay_due_today',
        };
      })(),
    );
  }

  if (shop || leasing) {
    tasks.push(
      (async () => {
        const payee =
          input.portal === 'leasing'
            ? { payeeKind: 'LEASING' as const }
            : { OR: [{ payeeKind: 'SHOP' as const }, { payeeKind: null }] };
        const agg = await prisma.payment.aggregate({
          where: {
            kind: 'PAYMENT',
            createdAt: { gte: from, lte: to },
            ...payee,
          },
          _sum: { amount: true },
          _count: true,
        });
        return {
          key: 'collected_today' as const,
          label: 'Өнөөдөр орсон төлбөр',
          count: agg._count,
          amount: agg._sum.amount ?? 0,
          href: shop ? '/workspace/shop?claimed=1' : '/workspace/leasing',
        };
      })(),
    );
  }

  if (canViewAllSettlements(input.role) || input.role === 'LEASING') {
    tasks.push(
      (async () => {
        const summary = await daySummary({
          ownerAdminId: ownerFilter,
          day: from,
        });
        return {
          key: 'unpaid_itgel' as const,
          label: 'Итгэлд төлөөгүй тооцоо',
          count: summary.totalUnpaidCount,
          amount: summary.totalUnpaidRemaining,
          href: '/workspace/shop/leasing-settlements?remaining=1',
        };
      })(),
    );
  }

  if (shop) {
    tasks.push(
      (async () => {
        const items = await prisma.orderItem.findMany({
          where: {
            cancelledAt: null,
            arrivedQty: { gt: 0 },
            order: { deletedAt: null, status: { not: 'CANCELLED' }, ...SHOP_STAFF_ORDER_WHERE },
          },
          select: {
            orderId: true,
            qty: true,
            arrivedQty: true,
            handedOverQty: true,
            handedOverAt: true,
            cancelledAt: true,
          },
        });
        const pickable = items.filter((item) => pickableQtyOf(item) > 0);
        const orderIds = new Set(pickable.map((item) => item.orderId));
        const pieceCount = pickable.reduce((sum, item) => sum + pickableQtyOf(item), 0);
        return {
          key: 'arrived_unhanded' as const,
          label: 'Ирсэн, олгоогүй',
          count: orderIds.size,
          amount: pieceCount,
          href: '/workspace/shop/handover',
        };
      })(),
    );
  }

  const batchCards: TodayCard[] = [];
  if (shop && (canWriteShop(input.role) || input.role === 'OWNER')) {
    const batches = await prisma.batch.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    const qty = await qtyByBatchIds(batches.map((b) => b.id));
    let short = 0;
    let unlinked = 0;
    for (const row of qty.values()) {
      if (row.linkedQty - row.arrivedQty > 0) short += 1;
      if (row.unlinkedQty > 0) unlinked += 1;
    }
    batchCards.push(
      {
        key: 'short_cargo',
        label: 'Дутуу ачаа',
        count: short,
        amount: null,
        href: '/workspace/shop/batches?progress=mismatch',
      },
      {
        key: 'unlinked_batch',
        label: 'Холбоос дутуу багц',
        count: unlinked,
        amount: null,
        href: '/workspace/shop/batches?progress=mismatch',
      },
    );
  }

  if (canViewAllSettlements(input.role) || input.role === 'LEASING') {
    tasks.push(
      prisma.moneyException
        .count({
          where: {
            status: 'OPEN',
            ...(ownerFilter
              ? { settlementPayment: { ownerAdminId: ownerFilter } }
              : {}),
          },
        })
        .then((count) => ({
          key: 'money_exception' as const,
          label: 'Шалгах төлбөр / зөрүү',
          count,
          amount: null,
          href: '/workspace/shop/leasing-settlements?tab=exceptions',
        })),
    );
  }

  if (smsChannel) {
    tasks.push(
      prisma.smsDispatch
        .count({ where: { channel: smsChannel, status: 'failed', purpose: { notIn: ['otp_login', 'otp_change'] } } })
        .then((count) => ({
          key: 'sms_failed' as const,
          label: 'Амжилтгүй SMS',
          count,
          amount: null,
          href: smsChannel === 'shop' ? '/workspace/shop/today?card=sms_failed' : '/workspace/leasing/today?card=sms_failed',
        })),
    );
    tasks.push(
      prisma.smsDispatch
        .count({ where: { channel: smsChannel, status: 'unknown', purpose: { notIn: ['otp_login', 'otp_change'] } } })
        .then((count) => ({
          key: 'sms_unknown' as const,
          label: 'Төлөв тодорхойгүй SMS',
          count,
          amount: null,
          href: smsChannel === 'shop' ? '/workspace/shop/today?card=sms_unknown' : '/workspace/leasing/today?card=sms_unknown',
        })),
    );
  }

  const resolved = await Promise.all(tasks);
  const cards: TodayCard[] = [...resolved.filter((row): row is TodayCard => Boolean(row)), ...batchCards];

  return { day: ubDateString(from), cards };
}

function pageMeta(total: number, page: number, pageSize: number) {
  return { total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function loadTodayCardRows(input: {
  role: AdminRoleName;
  actorId: string;
  card: TodayCardKey;
  ownerAdminId?: string | null;
  page?: number;
  day?: string | null;
  portal: 'shop' | 'leasing';
}) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = 30;
  const skip = (page - 1) * pageSize;
  const smsChannel = smsChannelFor(input.portal);
  const day = input.day ? parseUbDay(input.day) : new Date();
  const from = startOfUbDay(day);
  const to = endOfUbDay(day);
  const shop = input.portal === 'shop' && canAccessStaff(input.role);
  const leasing = input.portal === 'leasing' && canAccessLeasing(input.role);
  const ownerFilter =
    input.role === 'OWNER' && input.ownerAdminId?.trim()
      ? input.ownerAdminId.trim()
      : input.role === 'LEASING'
        ? input.actorId
        : undefined;

  if ((input.card === 'sms_failed' || input.card === 'sms_unknown') && smsChannel) {
    const status = input.card === 'sms_failed' ? 'failed' : 'unknown';
    const where = {
      channel: smsChannel,
      status,
      purpose: { notIn: ['otp_login', 'otp_change'] },
    };
    const [total, rows] = await Promise.all([
      prisma.smsDispatch.count({ where }),
      prisma.smsDispatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          purpose: true,
          status: true,
          relatedId: true,
          relatedType: true,
          createdAt: true,
          error: true,
        },
      }),
    ]);
    return {
      card: input.card,
      meta: pageMeta(total, page, pageSize),
      data: rows.map((row) => ({
        id: row.id,
        purpose: row.purpose,
        status: row.status,
        relatedId: row.relatedId,
        relatedType: row.relatedType,
        createdAt: row.createdAt.toISOString(),
        error: row.error,
      })),
    };
  }

  if (input.card === 'arrived_unhanded' && shop) {
    const items = await prisma.orderItem.findMany({
      where: {
        cancelledAt: null,
        arrivedQty: { gt: 0 },
        order: { deletedAt: null, status: { not: 'CANCELLED' }, ...SHOP_STAFF_ORDER_WHERE },
      },
      select: {
        orderId: true,
        qty: true,
        arrivedQty: true,
        handedOverQty: true,
        handedOverAt: true,
        cancelledAt: true,
        order: { select: { id: true, code: true, status: true, arrivedAt: true } },
      },
    });
    const byOrder = new Map<string, { id: string; code: string; status: string; at: string | null; pieces: number }>();
    for (const item of items) {
      const pieces = pickableQtyOf(item);
      if (pieces <= 0) continue;
      const current = byOrder.get(item.orderId);
      if (current) current.pieces += pieces;
      else {
        byOrder.set(item.orderId, {
          id: item.order.id,
          code: item.order.code,
          status: item.order.status,
          at: item.order.arrivedAt?.toISOString() ?? null,
          pieces,
        });
      }
    }
    const matched = [...byOrder.values()];
    return {
      card: input.card,
      meta: pageMeta(matched.length, page, pageSize),
      data: matched.slice(skip, skip + pageSize).map((row) => ({
        id: row.id,
        code: row.code,
        status: row.status,
        amount: row.pieces,
        at: row.at,
        href: `/workspace/shop/handover?code=${row.code}`,
      })),
    };
  }

  if (input.card === 'due_today' && leasing) {
    const gaps = await currentLeasingPayGaps();
    const orders = await prisma.order.findMany({
      where: {
        deletedAt: null,
        isLeasing: true,
        status: { not: 'CANCELLED' },
        dueAmount: { gt: 0 },
        debtClosedAt: null,
      },
      select: {
        id: true,
        code: true,
        createdAt: true,
        subtotal: true,
        leasingFee: true,
        paidAmount: true,
        refundedAmount: true,
        isLeasing: true,
        dueAmount: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const matched = orders.flatMap((order) => {
      const plan = buildLeasingPayPlan({ ...order, payGaps: gaps });
      const steps = plan?.steps.filter((s) => s.status === 'due_today') ?? [];
      if (steps.length === 0) return [];
      return [{
        id: order.id,
        code: order.code,
        amount: steps.reduce((sum, step) => sum + step.amount, 0),
        paidAmount: steps.reduce((sum, step) => sum + step.paidAmount, 0),
        remainingAmount: steps.reduce((sum, step) => sum + step.remaining, 0),
        href: `/workspace/leasing?order=${order.id}`,
      }];
    });
    return {
      card: input.card,
      meta: pageMeta(matched.length, page, pageSize),
      data: matched.slice(skip, skip + pageSize),
    };
  }

  if (input.card === 'collected_today' && (shop || leasing)) {
    const payee =
      input.portal === 'leasing'
        ? { payeeKind: 'LEASING' as const }
        : { OR: [{ payeeKind: 'SHOP' as const }, { payeeKind: null }] };
    const where = {
      kind: 'PAYMENT' as const,
      createdAt: { gte: from, lte: to },
      ...payee,
    };
    const [total, rows] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          amount: true,
          createdAt: true,
          order: { select: { id: true, code: true } },
        },
      }),
    ]);
    return {
      card: input.card,
      meta: pageMeta(total, page, pageSize),
      data: rows.map((row) => ({
        id: row.id,
        code: row.order.code,
        amount: row.amount,
        at: row.createdAt.toISOString(),
        href: shop
          ? `/workspace/shop?q=${row.order.code}`
          : `/workspace/leasing?order=${row.order.id}`,
      })),
    };
  }

  if (input.card === 'unpaid_itgel' && (canViewAllSettlements(input.role) || input.role === 'LEASING')) {
    const where = {
      status: { in: ['OPEN', 'INVOICED', 'PENDING_BANK'] },
      ...(ownerFilter ? { ownerAdminId: ownerFilter } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.itgelSettlement.count({ where }),
      prisma.itgelSettlement.findMany({
        where,
        orderBy: { confirmedAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          sourceOrderCode: true,
          remainingAmount: true,
          productName: true,
        },
      }),
    ]);
    return {
      card: input.card,
      meta: pageMeta(total, page, pageSize),
      data: rows.map((row) => ({
        id: row.id,
        code: row.sourceOrderCode,
        amount: row.remainingAmount,
        label: row.productName,
        href: '/workspace/shop/leasing-settlements?remaining=1',
      })),
    };
  }

  if (
    (input.card === 'short_cargo' || input.card === 'unlinked_batch') &&
    (canWriteShop(input.role) || input.role === 'OWNER')
  ) {
    const batches = await prisma.batch.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { createdAt: 'desc' },
    });
    const qty = await qtyByBatchIds(batches.map((b) => b.id));
    const matched = batches.flatMap((batch) => {
      const row = qty.get(batch.id);
      if (!row) return [];
      const ok =
        input.card === 'short_cargo'
          ? row.linkedQty - row.arrivedQty > 0
          : row.unlinkedQty > 0;
      if (!ok) return [];
      return [
        {
          id: batch.id,
          code: batch.name,
          amount: input.card === 'short_cargo' ? row.linkedQty - row.arrivedQty : row.unlinkedQty,
          href: `/workspace/shop/batches/${batch.id}`,
        },
      ];
    });
    return {
      card: input.card,
      meta: pageMeta(matched.length, page, pageSize),
      data: matched.slice(skip, skip + pageSize),
    };
  }

  if (input.card === 'money_exception' && (canViewAllSettlements(input.role) || input.role === 'LEASING')) {
    const where = {
      status: 'OPEN',
      ...(ownerFilter ? { settlementPayment: { ownerAdminId: ownerFilter } } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.moneyException.count({ where }),
      prisma.moneyException.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          kind: true,
          amount: true,
          createdAt: true,
          order: { select: { code: true } },
        },
      }),
    ]);
    return {
      card: input.card,
      meta: pageMeta(total, page, pageSize),
      data: rows.map((row) => ({
        id: row.id,
        code: row.order?.code ?? row.kind,
        amount: row.amount,
        label: row.kind,
        at: row.createdAt.toISOString(),
        href: '/workspace/shop/leasing-settlements?tab=exceptions',
      })),
    };
  }

  return { card: input.card, meta: pageMeta(0, page, pageSize), data: [] };
}
