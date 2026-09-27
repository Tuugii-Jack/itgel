import { prisma } from '../prisma.js';
import { addUbMonths, parseUbDay, startOfUbMonth, ubDateString } from '../lib/date.js';
import { loadHandoverSales } from '../lib/handoverEvents.js';
import { itemSelections } from '../lib/options.js';

export const HANDOVER_PAY_NOTE = 'Хүлээлгэн өгөх үед авсан';

export type HandoverHistoryItem = {
  name: string;
  selections: Record<string, string>;
  size: string | null;
  color: string | null;
  qty: number;
};

export type HandoverHistoryRow = {
  customerId: string;
  name: string | null;
  phone: string | null;
  at: string;
  orderCodes: string[];
  items: HandoverHistoryItem[];
  cash: number;
  card: number;
  bank: number;
};

export type HandoverHistoryDay = {
  date: string;
  itemCount: number;
  customerCount: number;
  cash: number;
  card: number;
  bank: number;
  rows: HandoverHistoryRow[];
  unknownRecords: {
    orderCode: string;
    customerId: string;
    name: string | null;
    phone: string | null;
    at: string;
    label: string;
  }[];
};

type Group = HandoverHistoryRow & { codes: Set<string>; pay: Set<string> };

type DayAcc = {
  itemCount: number;
  customers: Set<string>;
  cash: number;
  card: number;
  bank: number;
  seenPay: Set<string>;
  groups: Map<string, Group>;
  unknown: Map<string, {
    orderCode: string;
    customerId: string;
    name: string | null;
    phone: string | null;
    at: string;
    label: string;
  }>;
};

function splitPay(method: string, amount: number): { cash: number; card: number; bank: number } {
  if (method === 'CASH') return { cash: amount, card: 0, bank: 0 };
  if (method === 'BANK_TRANSFER') return { cash: 0, card: 0, bank: amount };
  return { cash: 0, card: amount, bank: 0 };
}

function emptyGroup(customer: {
  id: string;
  name: string | null;
  phone: string | null;
}, at: string): Group {
  return {
    customerId: customer.id,
    name: customer.name,
    phone: customer.phone,
    at,
    orderCodes: [],
    items: [],
    cash: 0,
    card: 0,
    bank: 0,
    codes: new Set<string>(),
    pay: new Set<string>(),
  };
}

/** Тухайн сард хүлээлгэн өгсөн бараа + бэлэн/карт орлого. */
export async function handoverHistory(year: number, month: number): Promise<{
  year: number;
  month: number;
  days: HandoverHistoryDay[];
  summary: { itemCount: number; customerCount: number; cash: number; card: number; bank: number };
}> {
  const from = startOfUbMonth(parseUbDay(`${year}-${String(month).padStart(2, '0')}-01`));
  const to = addUbMonths(from, 1);

  const [sales, payments] = await Promise.all([
    loadHandoverSales({ from, to }),
    prisma.payment.findMany({
      where: {
        kind: 'PAYMENT',
        createdAt: { gte: from, lt: to },
        note: { contains: 'Хүлээлгэн өгөх' },
        method: { in: ['CASH', 'CARD', 'BANK_TRANSFER'] },
      },
      select: {
        id: true,
        amount: true,
        method: true,
        createdAt: true,
        order: {
          select: {
            code: true,
            customer: { select: { id: true, name: true, phone: true } },
          },
        },
      },
    }),
  ]);

  const byDay = new Map<string, DayAcc>();

  const dayEntry = (date: string): DayAcc => {
    const entry = byDay.get(date) ?? {
      itemCount: 0,
      customers: new Set<string>(),
      cash: 0,
      card: 0,
      bank: 0,
      seenPay: new Set<string>(),
      groups: new Map(),
      unknown: new Map(),
    };
    byDay.set(date, entry);
    return entry;
  };

  const customerGroup = (
    day: DayAcc,
    customer: { id: string; name: string | null; phone: string | null },
    at: string,
  ): Group => {
    const group = day.groups.get(customer.id) ?? emptyGroup(customer, at);
    if (at > group.at) group.at = at;
    day.groups.set(customer.id, group);
    day.customers.add(customer.id);
    return group;
  };

  const events = sales.events;
  const eventItems = events.length
    ? await prisma.orderItem.findMany({
        where: { id: { in: [...new Set(events.map((event) => event.itemId))] } },
        select: {
          id: true,
          nameSnapshot: true,
          selections: true,
          size: true,
          color: true,
          order: {
            select: {
              code: true,
              customer: { select: { id: true, name: true, phone: true } },
            },
          },
        },
      })
    : [];
  const itemById = new Map(eventItems.map((item) => [item.id, item]));

  for (const event of events) {
    const item = itemById.get(event.itemId);
    if (!item) continue;
    const date = ubDateString(event.at);
    const day = dayEntry(date);
    day.itemCount += event.qty;
    const group = customerGroup(day, item.order.customer, event.at.toISOString());
    group.codes.add(item.order.code);
    const existing = group.items.find(
      (row) =>
        row.name === item.nameSnapshot &&
        row.size === item.size &&
        row.color === item.color &&
        JSON.stringify(row.selections) === JSON.stringify(itemSelections(item)),
    );
    if (existing) existing.qty += event.qty;
    else {
      group.items.push({
        name: item.nameSnapshot,
        selections: itemSelections(item),
        size: item.size,
        color: item.color,
        qty: event.qty,
      });
    }
  }

  if (sales.unknown.length > 0) {
    const unknownOrders = await prisma.order.findMany({
      where: { id: { in: [...new Set(sales.unknown.map((row) => row.orderId))] } },
      select: {
        id: true,
        code: true,
        customer: { select: { id: true, name: true, phone: true } },
      },
    });
    const byOrder = new Map(unknownOrders.map((order) => [order.id, order]));
    for (const row of sales.unknown) {
      const order = byOrder.get(row.orderId);
      if (!order) continue;
      const date = ubDateString(row.at);
      const day = dayEntry(date);
      day.customers.add(order.customer.id);
      day.unknown.set(`${order.id}:${row.at.toISOString()}`, {
        orderCode: order.code,
        customerId: order.customer.id,
        name: order.customer.name,
        phone: order.customer.phone,
        at: row.at.toISOString(),
        label: 'Хуучин бүртгэл / задаргаа тодорхойгүй',
      });
    }
  }

  for (const pay of payments) {
    const date = ubDateString(pay.createdAt);
    const day = dayEntry(date);
    if (day.seenPay.has(pay.id)) continue;
    day.seenPay.add(pay.id);
    const parts = splitPay(pay.method, pay.amount);
    day.cash += parts.cash;
    day.card += parts.card;
    day.bank += parts.bank;
    const group = customerGroup(day, pay.order.customer, pay.createdAt.toISOString());
    group.codes.add(pay.order.code);
    if (!group.pay.has(pay.id)) {
      group.pay.add(pay.id);
      group.cash += parts.cash;
      group.card += parts.card;
      group.bank += parts.bank;
    }
  }

  const days: HandoverHistoryDay[] = [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, v]) => ({
      date,
      itemCount: v.itemCount,
      customerCount: v.customers.size,
      cash: v.cash,
      card: v.card,
      bank: v.bank,
      rows: [...v.groups.values()]
        .map((g) => ({
          customerId: g.customerId,
          name: g.name,
          phone: g.phone,
          at: g.at,
          items: g.items,
          cash: g.cash,
          card: g.card,
          bank: g.bank,
          orderCodes: [...g.codes].sort(),
        }))
        .sort((a, b) => b.at.localeCompare(a.at)),
      unknownRecords: [...v.unknown.values()].sort((a, b) => b.at.localeCompare(a.at)),
    }));

  const allCustomers = new Set<string>();
  for (const day of days) {
    for (const row of day.rows) allCustomers.add(row.customerId);
    for (const row of day.unknownRecords) allCustomers.add(row.customerId);
  }

  return {
    year,
    month,
    days,
    summary: {
      itemCount: days.reduce((sum, d) => sum + d.itemCount, 0),
      customerCount: allCustomers.size,
      cash: days.reduce((sum, d) => sum + d.cash, 0),
      card: days.reduce((sum, d) => sum + d.card, 0),
      bank: days.reduce((sum, d) => sum + d.bank, 0),
    },
  };
}
