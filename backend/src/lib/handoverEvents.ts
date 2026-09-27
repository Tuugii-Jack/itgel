import { prisma } from '../prisma.js';
import { handedQtyOf } from './itemQty.js';

export type HandoverPieceEvent = {
  at: Date;
  orderId: string;
  itemId: string;
  qty: number;
  source: 'piece' | 'legacy_full';
};

export type HandoverUnknownRecord = {
  at: Date;
  orderId: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Audit after.lines[].qty — ширхэггүй хуучин мөрийг таамаглаж нөхөхгүй. */
export function parseHandoverAuditLines(after: unknown): { itemId: string; qty: number }[] {
  const rec = asObject(after);
  if (!rec || !Array.isArray(rec.lines)) return [];
  const out: { itemId: string; qty: number }[] = [];
  for (const line of rec.lines) {
    const row = asObject(line);
    if (!row) continue;
    if (typeof row.itemId !== 'string' || !row.itemId) continue;
    const qty = row.qty;
    if (!Number.isInteger(qty) || (qty as number) < 1) continue;
    out.push({ itemId: row.itemId, qty: qty as number });
  }
  return out;
}

export async function loadHandoverSales(input: {
  from: Date;
  to: Date;
  itemIds?: string[];
}): Promise<{ events: HandoverPieceEvent[]; unknown: HandoverUnknownRecord[] }> {
  const logs = await prisma.auditLog.findMany({
    where: {
      action: { in: ['HANDOVER', 'HANDOVER_PARTIAL'] },
      entity: 'Order',
      createdAt: { gte: input.from, lt: input.to },
    },
    select: { createdAt: true, entityId: true, after: true },
    orderBy: { createdAt: 'asc' },
  });

  const events: HandoverPieceEvent[] = [];
  const coveredQty = new Map<string, number>();
  const ordersWithLines = new Set<string>();
  const linelessOrderIds = new Set<string>();
  const linelessAudits: HandoverUnknownRecord[] = [];

  for (const log of logs) {
    const lines = parseHandoverAuditLines(log.after);
    if (lines.length > 0) {
      ordersWithLines.add(log.entityId);
      for (const line of lines) {
        if (input.itemIds && !input.itemIds.includes(line.itemId)) continue;
        events.push({
          at: log.createdAt,
          orderId: log.entityId,
          itemId: line.itemId,
          qty: line.qty,
          source: 'piece',
        });
        coveredQty.set(line.itemId, (coveredQty.get(line.itemId) ?? 0) + line.qty);
      }
      continue;
    }
    linelessOrderIds.add(log.entityId);
    linelessAudits.push({ at: log.createdAt, orderId: log.entityId });
  }

  const orFilters: {
    id?: { in: string[] };
    orderId?: { in: string[] };
    handedOverAt?: { gte: Date; lt: Date };
  }[] = [{ handedOverAt: { gte: input.from, lt: input.to } }];
  if (coveredQty.size > 0) orFilters.push({ id: { in: [...coveredQty.keys()] } });
  if (linelessOrderIds.size > 0) orFilters.push({ orderId: { in: [...linelessOrderIds] } });

  const legacyCandidates = await prisma.orderItem.findMany({
    where: {
      cancelledAt: null,
      ...(input.itemIds ? { id: { in: input.itemIds } } : {}),
      OR: orFilters,
    },
    select: {
      id: true,
      orderId: true,
      qty: true,
      arrivedQty: true,
      handedOverQty: true,
      handedOverAt: true,
      cancelledAt: true,
    },
  });

  const attributedLegacyOrders = new Set<string>();
  for (const item of legacyCandidates) {
    const covered = coveredQty.get(item.id) ?? 0;
    if (covered > 0) continue;
    const handed = handedQtyOf(item);
    const at = item.handedOverAt;
    if (!at || at < input.from || at >= input.to) continue;
    if (handed < item.qty || handed < 1) continue;
    events.push({
      at,
      orderId: item.orderId,
      itemId: item.id,
      qty: handed,
      source: 'legacy_full',
    });
    coveredQty.set(item.id, handed);
    attributedLegacyOrders.add(item.orderId);
  }

  const unexplainedOrders = new Set<string>();
  for (const item of legacyCandidates) {
    const covered = coveredQty.get(item.id) ?? 0;
    const handed = handedQtyOf(item);
    if (handed > covered) unexplainedOrders.add(item.orderId);
  }

  const unknown = linelessAudits.filter(
    (row) => unexplainedOrders.has(row.orderId) && !attributedLegacyOrders.has(row.orderId),
  );

  return { events, unknown };
}

/** Шинэ piece event + хуучин бүрэн олголт. Задаргаагүй аудитыг оруулахгүй. */
export async function loadHandoverPieceEvents(input: {
  from: Date;
  to: Date;
  itemIds?: string[];
}): Promise<HandoverPieceEvent[]> {
  const { events } = await loadHandoverSales(input);
  return events;
}
