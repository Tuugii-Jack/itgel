import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { lockOrders } from '../lib/orderLock.js';
import {
  formatSelectionsLabel,
  itemSelections,
  variantKey,
} from '../lib/options.js';
import { skuKeyOf } from '../lib/skuStock.js';
import { isProductPaid } from './money.js';
import { promoteOrdersToArrived } from './orders.js';

export type WaitingLine = {
  id: string;
  orderId: string;
  orderCode?: string;
  qty: number;
  arrivedQty: number;
  orderCreatedAt: Date;
};

export type Allocation = {
  id: string;
  orderId: string;
  orderCode?: string;
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
    const row: Allocation = {
      id: item.id,
      orderId: item.orderId,
      add: take,
      fullyArrived: item.arrivedQty + take >= item.qty,
    };
    if (item.orderCode) row.orderCode = item.orderCode;
    allocations.push(row);
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
    const row: Allocation = {
      id: item.id,
      orderId: item.orderId,
      add: -take,
      fullyArrived: next >= item.qty,
    };
    if (item.orderCode) row.orderCode = item.orderCode;
    changes.push(row);
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
    // Хүлээлгэн өгсөн бараа ирсэн НИЙТ тоонд хэвээр орно.
    status: { not: 'CANCELLED' },
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
          leasingFee: true,
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
    if (!item.handedOverAt && !isProductPaid(item.order)) continue;
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
    agg.arrivedQty += item.handedOverAt ? item.qty : Math.min(item.arrivedQty, item.qty);
    if (item.handedOverAt) agg.handedOverQty += item.qty;
    if (!item.handedOverAt && item.arrivedQty < item.qty) {
      agg.waitingCustomers.add(item.order.customerId);
    }
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
export type RegisterArrivalOpts = {
  expected?: { roundId: string; selections: Record<string, string>; arrivedQty: number }[];
  reason?: string;
  notes?: ArrivalNoteInput[];
};

export type ArrivalNoteInput = {
  roundId: string;
  selections: Record<string, string>;
  kind: 'DAMAGED' | 'SHORT' | 'EXCESS';
  qty: number;
  note: string;
};

export async function registerBatchArrivals(
  batchId: string,
  lines: RegisterArrivalLine[],
  actor: string,
  now = new Date(),
  opts: RegisterArrivalOpts = {},
): Promise<RegisterArrivalResult> {
  if (lines.length === 0) throw badRequest('Ирсэн тоо оруулна уу.');

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`batch-arrival:${batchId}`}))`;
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
    if (batch.rounds.length === 0) {
      throw conflict('Холбоос дутуу. Тойрог холбохгүйгээр ирэлт бүртгэхгүй.');
    }

    const roundIds = new Set(batch.rounds.map((r) => r.id));
    for (const line of lines) {
      if (!roundIds.has(line.roundId)) {
        throw badRequest('Энэ багцад байхгүй бараа байна.', { roundId: line.roundId });
      }
      if (line.arrivedQty < 0) throw badRequest('Ирсэн тоо сөрөг байж болохгүй.');
    }

    // Хүлээлгэн өгөх/цуцлахтай зэрэгцвэл шинэ төлөвийг нь уншиж тооцно.
    const participatingOrders = await tx.order.findMany({
      where: { items: { some: { roundId: { in: lines.map((line) => line.roundId) } } } },
      select: { id: true },
    });
    await lockOrders(tx, participatingOrders.map((order) => order.id));

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
            code: true,
            createdAt: true,
            subtotal: true,
            paidAmount: true,
            refundedAmount: true,
            leasingFee: true,
          },
        },
      },
    });

    type Row = (typeof items)[number];
    const byVariant = new Map<string, Row[]>();
    for (const item of items) {
      if (!item.handedOverAt && !isProductPaid(item.order)) continue;
      const key = `${item.roundId}\0${variantKey(itemSelections(item))}`;
      const list = byVariant.get(key) ?? [];
      list.push(item);
      byVariant.set(key, list);
    }

    const toLine = (row: Row): WaitingLine => ({
      id: row.id,
      orderId: row.orderId,
      orderCode: row.order.code,
      qty: row.qty,
      arrivedQty: row.arrivedQty,
      orderCreatedAt: row.order.createdAt,
    });

    if (opts.expected && opts.expected.length > 0) {
      for (const line of lines) {
        const key = `${line.roundId}\0${variantKey(line.selections)}`;
        const pool = byVariant.get(key) ?? [];
        const current = pool.reduce(
          (s, i) => s + (i.handedOverAt ? i.qty : Math.min(i.arrivedQty, i.qty)),
          0,
        );
        const expected = opts.expected.find(
          (row) =>
            row.roundId === line.roundId && variantKey(row.selections) === variantKey(line.selections),
        );
        if (!expected || expected.arrivedQty !== current) {
          throw conflict('Preview-ийн дараа өгөгдөл өөрчлөгдсөн. Дахин шалгана уу.', {
            roundId: line.roundId,
            selections: line.selections,
            expected: expected?.arrivedQty ?? null,
            current,
          });
        }
      }
    }

    let allocated = 0;
    let released = 0;
    let unused = 0;
    const fullyOrderIds = new Set<string>();
    const maybeDemote = new Set<string>();

    for (const line of lines) {
      const key = `${line.roundId}\0${variantKey(line.selections)}`;
      const pool = byVariant.get(key) ?? [];
      const ordered = pool.reduce((s, i) => s + i.qty, 0);
      const current = pool.reduce(
        (s, i) => s + (i.handedOverAt ? i.qty : Math.min(i.arrivedQty, i.qty)),
        0,
      );
      const locked = pool.filter((i) => i.handedOverAt).reduce((s, i) => s + i.qty, 0);
      if (line.arrivedQty < locked) {
        throw conflict(
          `${formatSelectionsLabel(line.selections)}: ${locked} ш хүлээлгэн өгсөн тул ${line.arrivedQty} болгож болохгүй.`,
        );
      }
      if (line.arrivedQty > ordered) {
        const extra = line.arrivedQty - ordered;
        const noted = (opts.notes ?? [])
          .filter(
            (note) =>
              note.kind === 'EXCESS' &&
              note.roundId === line.roundId &&
              variantKey(note.selections) === variantKey(line.selections),
          )
          .reduce((sum, note) => sum + note.qty, 0);
        if (noted < extra) {
          throw badRequest(
            `${formatSelectionsLabel(line.selections)}: захиалснаас ${extra} ш илүү. Илүү тоо борлуулах үлдэгдэлд нэмэгдэхгүй — зөрүүгээр бүртгэнэ.`,
          );
        }
      }
      const target = Math.min(ordered, line.arrivedQty);
      if (line.arrivedQty > ordered) unused += line.arrivedQty - ordered;
      const delta = target - current;
      if (delta === 0) continue;
      if (delta < 0 && !opts.reason?.trim()) {
        throw badRequest('Ирсэн тоог багасгахдаа шалтгаан бичнэ.');
      }

      if (delta > 0) {
        const waiting = pool.filter((i) => !i.handedOverAt && i.arrivedQty < i.qty).map(toLine);
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

    const reverted = await demoteOrdersMissingArrival(
      tx,
      [...maybeDemote],
      actor,
      `Багц "${batch.name}" — ирсэн тоо зассан`,
    );

    await writeArrivalNotes(tx, batch.id, actor, opts.notes);

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
          reason: opts.reason ?? null,
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

  return result;
}

async function writeArrivalNotes(
  tx: Prisma.TransactionClient,
  batchId: string,
  actor: string,
  notes: ArrivalNoteInput[] | undefined,
) {
  if (!notes?.length) return;
  for (const note of notes) {
    if (note.qty <= 0) throw badRequest('Зөрүүний тоо 0-ээс их байна.');
    if (note.kind !== 'DAMAGED' && note.kind !== 'SHORT' && note.kind !== 'EXCESS') {
      throw badRequest('Зөрүүний төрөл буруу.');
    }
    await tx.batchArrivalNote.create({
      data: {
        batchId,
        roundId: note.roundId,
        skuKey: skuKeyOf(note.selections),
        selections: note.selections,
        kind: note.kind,
        qty: note.qty,
        note: note.note.trim().slice(0, 300),
        actor,
      },
    });
  }
}

export type ArrivalAddLine = {
  roundId: string;
  selections: Record<string, string>;
  addQty: number;
};

export type ArrivalPreviewOrder = {
  orderId: string;
  code: string;
  add: number;
  remainingAfter: number;
  fullyArrived: boolean;
};

export type ArrivalPreviewLine = {
  roundId: string;
  selections: Record<string, string>;
  label: string;
  currentArrived: number;
  orderedQty: number;
  addQty: number;
  allocations: ArrivalPreviewOrder[];
  stillWaiting: { orderId: string; code: string; remaining: number }[];
};

export async function previewBatchArrivalAdds(batchId: string, lines: ArrivalAddLine[]) {
  if (lines.length === 0) throw badRequest('Энэ удаа ирсэн тоо оруулна уу.');
  const batch = await prisma.batch.findFirst({
    where: { id: batchId, deletedAt: null },
    include: { rounds: { where: { deletedAt: null }, select: { id: true } } },
  });
  if (!batch) throw notFound('Багц олдсонгүй.');
  if (batch.stage !== 'IN_TRANSIT') {
    throw conflict('Ирсэн тоог зөвхөн зам дээр байх үед бүртгэнэ.');
  }
  if (batch.rounds.length === 0) {
    throw conflict('Холбоос дутуу. Тойрог холбохгүйгээр ирэлт бүртгэхгүй.');
  }
  const roundIds = new Set(batch.rounds.map((r) => r.id));
  for (const line of lines) {
    if (!roundIds.has(line.roundId)) throw badRequest('Энэ багцад байхгүй бараа байна.');
    if (!Number.isInteger(line.addQty) || line.addQty < 0) {
      throw badRequest('Энэ удаа ирсэн тоо сөрөг байж болохгүй.');
    }
  }

  const items = await prisma.orderItem.findMany({
    where: {
      roundId: { in: lines.map((l) => l.roundId) },
      cancelledAt: null,
      order: eligibleOrderWhere(),
    },
    select: {
      id: true,
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
          code: true,
          createdAt: true,
          subtotal: true,
          paidAmount: true,
          refundedAmount: true,
          leasingFee: true,
        },
      },
    },
  });

  const preview: ArrivalPreviewLine[] = [];
  const expected: { roundId: string; selections: Record<string, string>; arrivedQty: number }[] = [];

  for (const line of lines) {
    if (line.addQty === 0) continue;
    const pool = items.filter(
      (item) =>
        item.roundId === line.roundId &&
        variantKey(itemSelections(item)) === variantKey(line.selections) &&
        (item.handedOverAt || isProductPaid(item.order)),
    );
    const orderedQty = pool.reduce((s, i) => s + i.qty, 0);
    const currentArrived = pool.reduce(
      (s, i) => s + (i.handedOverAt ? i.qty : Math.min(i.arrivedQty, i.qty)),
      0,
    );
    if (currentArrived + line.addQty > orderedQty) {
      throw badRequest(
        `${formatSelectionsLabel(line.selections)}: захиалснаас илүү тоо хуваарилагдахгүй.`,
      );
    }
    const waiting = pool
      .filter((i) => !i.handedOverAt && i.arrivedQty < i.qty)
      .map((i) => ({
        id: i.id,
        orderId: i.order.id,
        orderCode: i.order.code,
        qty: i.qty,
        arrivedQty: i.arrivedQty,
        orderCreatedAt: i.order.createdAt,
      }));
    const { allocations } = allocateFifo(waiting, line.addQty);
    const remainingById = new Map(waiting.map((w) => [w.orderId, w.qty - w.arrivedQty]));
    for (const row of allocations) {
      remainingById.set(row.orderId, (remainingById.get(row.orderId) ?? 0) - row.add);
    }
    preview.push({
      roundId: line.roundId,
      selections: line.selections,
      label: formatSelectionsLabel(line.selections),
      currentArrived,
      orderedQty,
      addQty: line.addQty,
      allocations: allocations.map((row) => ({
        orderId: row.orderId,
        code: row.orderCode ?? row.orderId,
        add: row.add,
        remainingAfter: remainingById.get(row.orderId) ?? 0,
        fullyArrived: row.fullyArrived,
      })),
      stillWaiting: [...remainingById.entries()]
        .filter(([, remaining]) => remaining > 0)
        .map(([orderId, remaining]) => {
          const item = waiting.find((w) => w.orderId === orderId);
          return { orderId, code: item?.orderCode ?? orderId, remaining };
        }),
    });
    expected.push({ roundId: line.roundId, selections: line.selections, arrivedQty: currentArrived });
  }

  return {
    fifoNote: 'Түрүүлж захиалсан захиалгад эхлээд хуваарилна. Энэ дарааллыг өөрчлөхгүй.',
    lines: preview,
    expected,
  };
}

export async function confirmBatchArrivalAdds(
  batchId: string,
  input: {
    lines: ArrivalAddLine[];
    expected: { roundId: string; selections: Record<string, string>; arrivedQty: number }[];
    notes?: ArrivalNoteInput[];
  },
  actor: string,
) {
  const preview = await previewBatchArrivalAdds(batchId, input.lines);
  const setLines: RegisterArrivalLine[] = preview.lines.map((line) => ({
    roundId: line.roundId,
    selections: line.selections,
    arrivedQty: line.currentArrived + line.addQty,
  }));
  return registerBatchArrivals(batchId, setLines, actor, new Date(), {
    expected: input.expected,
    notes: input.notes,
  });
}
