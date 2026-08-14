import type { Order, Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import {
  formatSelectionsLabel,
  itemSelections,
  variantKey,
} from '../lib/options.js';
import { isProductPaid } from './money.js';
import { notifyArrival, promoteOrdersToArrived } from './orders.js';

export type WaitingLine = {
  id: string;
  orderId: string;
  qty: number;
  arrivedQty: number;
  orderCreatedAt: Date;
};

export type Allocation = {
  id: string;
  orderId: string;
  add: number;
  fullyArrived: boolean;
};

/** Түрүүлж захиалсан хүнд эхлээд ширхэг хуваарилна. */
export function allocateFifo(items: WaitingLine[], incoming: number): {
  allocations: Allocation[];
  unused: number;
} {
  if (incoming <= 0) return { allocations: [], unused: 0 };
  const sorted = [...items].sort((a, b) => {
    const t = a.orderCreatedAt.getTime() - b.orderCreatedAt.getTime();
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });
  let left = incoming;
  const allocations: Allocation[] = [];
  for (const item of sorted) {
    if (left <= 0) break;
    const need = item.qty - item.arrivedQty;
    if (need <= 0) continue;
    const take = Math.min(need, left);
    left -= take;
    allocations.push({
      id: item.id,
      orderId: item.orderId,
      add: take,
      fullyArrived: item.arrivedQty + take >= item.qty,
    });
  }
  return { allocations, unused: left };
}

/** Сүүлд хуваарилсан хүмүүсээс буцаана (FIFO-ийн эсрэг). */
export function deallocateLifo(items: WaitingLine[], remove: number): {
  changes: Allocation[];
  shortfall: number;
} {
  if (remove <= 0) return { changes: [], shortfall: 0 };
  const sorted = [...items].sort((a, b) => {
    const t = b.orderCreatedAt.getTime() - a.orderCreatedAt.getTime();
    return t !== 0 ? t : b.id.localeCompare(a.id);
  });
  let left = remove;
  const changes: Allocation[] = [];
  for (const item of sorted) {
    if (left <= 0) break;
    if (item.arrivedQty <= 0) continue;
    const take = Math.min(item.arrivedQty, left);
    left -= take;
    const next = item.arrivedQty - take;
    changes.push({
      id: item.id,
      orderId: item.orderId,
      add: -take,
      fullyArrived: next >= item.qty,
    });
  }
  return { changes, shortfall: left };
}

export type ArrivalVariant = {
  key: string;
  selections: Record<string, string>;
  label: string;
  orderedQty: number;
  arrivedQty: number;
  remainingQty: number;
  waitingCustomers: number;
  /** Аль хэдийн хүлээлгэн өгсөн — үүнээс бага ирсэн болгож болохгүй. */
  handedOverQty: number;
};

export type RoundArrivalSummary = {
  roundId: string;
  variants: ArrivalVariant[];
};

function eligibleOrderWhere(): Prisma.OrderWhereInput {
  return {
    deletedAt: null,
    status: { notIn: ['CANCELLED', 'HANDED_OVER'] },
    batchOmittedAt: null,
  };
}

export async function summarizeRoundArrivals(
  tx: Prisma.TransactionClient | typeof prisma,
  roundIds: string[],
): Promise<Map<string, ArrivalVariant[]>> {
  const map = new Map<string, ArrivalVariant[]>();
  if (roundIds.length === 0) return map;

  const items = await tx.orderItem.findMany({
    where: {
      roundId: { in: roundIds },
      cancelledAt: null,
      order: eligibleOrderWhere(),
    },
    select: {
      roundId: true,
      qty: true,
      arrivedQty: true,
      handedOverAt: true,
      selections: true,
      size: true,
      color: true,
      order: {
        select: {
          id: true,
          customerId: true,
          subtotal: true,
          paidAmount: true,
          refundedAmount: true,
        },
      },
    },
  });

  type Agg = {
    selections: Record<string, string>;
    orderedQty: number;
    arrivedQty: number;
    handedOverQty: number;
    waitingCustomers: Set<string>;
  };
  const byRound = new Map<string, Map<string, Agg>>();

  for (const item of items) {
    if (!isProductPaid(item.order)) continue;
    const selections = itemSelections(item);
    const key = variantKey(selections);
    let roundMap = byRound.get(item.roundId);
    if (!roundMap) {
      roundMap = new Map();
      byRound.set(item.roundId, roundMap);
    }
    const agg =
      roundMap.get(key) ??
      ({
        selections,
        orderedQty: 0,
        arrivedQty: 0,
        handedOverQty: 0,
        waitingCustomers: new Set<string>(),
      } satisfies Agg);
    agg.orderedQty += item.qty;
    agg.arrivedQty += Math.min(item.arrivedQty, item.qty);
    if (item.handedOverAt) agg.handedOverQty += item.qty;
    if (item.arrivedQty < item.qty) agg.waitingCustomers.add(item.order.customerId);
    roundMap.set(key, agg);
  }

  for (const roundId of roundIds) {
    const roundMap = byRound.get(roundId);
    const variants: ArrivalVariant[] = roundMap
      ? [...roundMap.entries()]
          .map(([key, agg]) => ({
            key,
            selections: agg.selections,
            label: formatSelectionsLabel(agg.selections),
            orderedQty: agg.orderedQty,
            arrivedQty: agg.arrivedQty,
            remainingQty: Math.max(0, agg.orderedQty - agg.arrivedQty),
            waitingCustomers: agg.waitingCustomers.size,
            handedOverQty: agg.handedOverQty,
          }))
          .sort((a, b) => a.label.localeCompare(b.label, 'mn'))
      : [];
    map.set(roundId, variants);
  }
  return map;
}

export type RegisterArrivalLine = {
  roundId: string;
  selections: Record<string, string>;
  /** Энэ сонголтын ирсэн НИЙТ тоо (нэмэх биш — засаж болно). */
  arrivedQty: number;
};

export type RegisterArrivalResult = {
  allocated: number;
  released: number;
  unused: number;
  ordersArrived: string[];
  ordersReverted: string[];
};

async function demoteOrdersMissingArrival(
  tx: Prisma.TransactionClient,
  orderIds: string[],
  actor: string,
  reason: string,
): Promise<string[]> {
  const unique = [...new Set(orderIds)];
  if (unique.length === 0) return [];

  const orders = await tx.order.findMany({
    where: { id: { in: unique }, deletedAt: null, status: 'ARRIVED' },
    select: { id: true, code: true, status: true },
  });
  const demoted: string[] = [];

  for (const order of orders) {
    const items = await tx.orderItem.findMany({
      where: { orderId: order.id, cancelledAt: null },
      select: { qty: true, arrivedQty: true },
    });
    if (items.some((i) => i.arrivedQty >= i.qty)) continue;

    await tx.order.update({
      where: { id: order.id },
      data: { status: 'IN_TRANSIT', arrivedAt: null, arrivalNotifiedAt: null },
    });
    await audit(
      {
        actor,
        action: 'STATUS_REVERT',
        entity: 'Order',
        entityId: order.id,
        before: { status: 'ARRIVED' },
        after: { status: 'IN_TRANSIT', reason },
      },
      tx,
    );
    demoted.push(order.id);
  }
  return demoted;
}

/**
 * Сонголт бүрийн ирсэн НИЙТ тоог тавина — зөвхөн багц зам дээр байхад.
 * Ихэсвэл FIFO-оор нэмнэ; багасгавал сүүлд хуваарилсан хүмүүсээс буцаана.
 */
export async function registerBatchArrivals(
  batchId: string,
  lines: RegisterArrivalLine[],
  actor: string,
  now = new Date(),
): Promise<RegisterArrivalResult> {
  if (lines.length === 0) throw badRequest('Ирсэн тоо оруулна уу.');

  const arrivedOrderIds: string[] = [];
  const result = await prisma.$transaction(async (tx) => {
    const batch = await tx.batch.findFirst({
      where: { id: batchId, deletedAt: null },
      include: { rounds: { where: { deletedAt: null }, select: { id: true } } },
    });
    if (!batch) throw notFound('Багц олдсонгүй.');
    if (batch.stage === 'DONE') {
      throw conflict('Дууссан багцад ирсэн тоо бүртгэх боломжгүй.');
    }
    if (batch.stage !== 'IN_TRANSIT') {
      throw conflict('Ирсэн тоог зөвхөн зам дээр байх үед бүртгэнэ. Агуулахад орсон бол засагдахгүй.');
    }

    const roundIds = new Set(batch.rounds.map((r) => r.id));
    for (const line of lines) {
      if (!roundIds.has(line.roundId)) {
        throw badRequest('Энэ багцад байхгүй бараа байна.', { roundId: line.roundId });
      }
      if (line.arrivedQty < 0) throw badRequest('Ирсэн тоо сөрөг байж болохгүй.');
    }

    const items = await tx.orderItem.findMany({
      where: {
        roundId: { in: lines.map((l) => l.roundId) },
        cancelledAt: null,
        order: eligibleOrderWhere(),
      },
      select: {
        id: true,
        orderId: true,
        roundId: true,
        qty: true,
        arrivedQty: true,
        arrivedAt: true,
        handedOverAt: true,
        selections: true,
        size: true,
        color: true,
        order: {
          select: {
            id: true,
            createdAt: true,
            subtotal: true,
            paidAmount: true,
            refundedAmount: true,
          },
        },
      },
    });

    type Row = (typeof items)[number];
    const byVariant = new Map<string, Row[]>();
    for (const item of items) {
      if (!isProductPaid(item.order)) continue;
      const key = `${item.roundId}\0${variantKey(itemSelections(item))}`;
      const list = byVariant.get(key) ?? [];
      list.push(item);
      byVariant.set(key, list);
    }

    const toLine = (row: Row): WaitingLine => ({
      id: row.id,
      orderId: row.orderId,
      qty: row.qty,
      arrivedQty: row.arrivedQty,
      orderCreatedAt: row.order.createdAt,
    });

    let allocated = 0;
    let released = 0;
    let unused = 0;
    const fullyOrderIds = new Set<string>();
    const maybeDemote = new Set<string>();

    for (const line of lines) {
      const key = `${line.roundId}\0${variantKey(line.selections)}`;
      const pool = byVariant.get(key) ?? [];
      const ordered = pool.reduce((s, i) => s + i.qty, 0);
      const current = pool.reduce((s, i) => s + Math.min(i.arrivedQty, i.qty), 0);
      const locked = pool.filter((i) => i.handedOverAt).reduce((s, i) => s + i.qty, 0);
      if (line.arrivedQty < locked) {
        throw conflict(
          `${formatSelectionsLabel(line.selections)}: ${locked} ш хүлээлгэн өгсөн тул ${line.arrivedQty} болгож болохгүй.`,
        );
      }
      const target = Math.min(ordered, line.arrivedQty);
      if (line.arrivedQty > ordered) unused += line.arrivedQty - ordered;
      const delta = target - current;
      if (delta === 0) continue;

      if (delta > 0) {
        const waiting = pool.filter((i) => i.arrivedQty < i.qty).map(toLine);
        const { allocations, unused: leftover } = allocateFifo(waiting, delta);
        unused += leftover;
        for (const row of allocations) {
          allocated += row.add;
          const item = pool.find((p) => p.id === row.id);
          if (item) item.arrivedQty += row.add;
          await tx.orderItem.update({
            where: { id: row.id },
            data: {
              arrivedQty: item?.arrivedQty ?? row.add,
              ...(row.fullyArrived ? { arrivedAt: now } : {}),
            },
          });
          if (row.fullyArrived) fullyOrderIds.add(row.orderId);
        }
      } else {
        const unlocked = pool.filter((i) => i.arrivedQty > 0 && !i.handedOverAt).map(toLine);
        const { changes, shortfall } = deallocateLifo(unlocked, -delta);
        if (shortfall > 0) {
          throw conflict(
            `${formatSelectionsLabel(line.selections)}: ${shortfall} ш аль хэдийн өгсөн тул багасгах боломжгүй.`,
          );
        }
        for (const row of changes) {
          released += -row.add;
          const item = pool.find((p) => p.id === row.id);
          if (item) item.arrivedQty += row.add;
          const nextQty = item?.arrivedQty ?? 0;
          await tx.orderItem.update({
            where: { id: row.id },
            data: {
              arrivedQty: nextQty,
              arrivedAt: row.fullyArrived ? item?.arrivedAt ?? now : null,
            },
          });
          maybeDemote.add(row.orderId);
        }
      }
    }

    const promoted = await promoteOrdersToArrived(
      tx,
      [...fullyOrderIds],
      actor,
      `Багц "${batch.name}" — ирсэн бараа бүртгэв`,
      now,
    );
    arrivedOrderIds.push(...promoted);

    const reverted = await demoteOrdersMissingArrival(
      tx,
      [...maybeDemote],
      actor,
      `Багц "${batch.name}" — ирсэн тоо зассан`,
    );

    await audit(
      {
        actor,
        action: 'BATCH_ARRIVAL',
        entity: 'Batch',
        entityId: batch.id,
        after: {
          allocated,
          released,
          unused,
          ordersArrived: promoted.length,
          ordersReverted: reverted.length,
          lines: lines.map((l) => ({
            roundId: l.roundId,
            selections: l.selections,
            arrivedQty: l.arrivedQty,
          })),
        },
      },
      tx,
    );

    return { allocated, released, unused, ordersArrived: promoted, ordersReverted: reverted };
  });

  if (arrivedOrderIds.length > 0) {
    void (async () => {
      const orders = await prisma.order.findMany({ where: { id: { in: arrivedOrderIds } } });
      for (const order of orders) await notifyArrival(order as Order);
    })().catch((e) => console.warn('[sms] ирсэн мэдэгдэл алдаа:', e));
  }

  return result;
}
