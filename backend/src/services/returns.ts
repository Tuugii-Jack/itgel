import { prisma } from '../prisma.js';
import {
  payoutDateForReturn,
  payoutDaysInMonth,
  payoutWindow,
} from '../lib/date.js';
import { itemSelections, variantKey } from '../lib/options.js';

export type ReturnCalendarDay = {
  date: string;
  qty: number;
  itemCount: number;
  customerCount: number;
};

export type ReturnProduct = {
  productId: string;
  name: string;
  selections: Record<string, string>;
  size: string | null;
  color: string | null;
  qty: number;
  amount: number;
  orderCount: number;
  customerCount: number;
};

export type ReturnPayout = {
  customerId: string;
  name: string | null;
  phone: string | null;
  email: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  amount: number;
  qty: number;
  orderCodes: string[];
};

function rangesForDays(days: string[]): { gte: Date; lte: Date }[] {
  return [...new Set(days)].sort().map((day) => payoutWindow(day));
}

const customerSelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  bankName: true,
  bankAccountNumber: true,
  bankAccountName: true,
} as const;

const itemSelect = {
  id: true,
  productId: true,
  nameSnapshot: true,
  selections: true,
  size: true,
  color: true,
  qty: true,
  unitPrice: true,
  cancelledAt: true,
} as const;

type ItemRow = {
  id: string;
  productId: string;
  nameSnapshot: string;
  selections: unknown;
  size: string | null;
  color: string | null;
  qty: number;
  unitPrice: number;
  cancelledAt: Date | null;
};

type CustomerRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
};

const ITEM_REFUND_NOTE = 'Мөр цуцлагдсан: ';

/** Админ захиалгын дэлгэрэнгүйгээс хийсэн буцаалт — дэвтэрийн REFUND. */
function adminRefundWhere(createdAt: { gte: Date; lte?: Date; lt?: Date }) {
  return {
    kind: 'REFUND' as const,
    createdAt,
    actor: { startsWith: 'admin:' },
  };
}

function productsForRefund(note: string | null, items: ItemRow[]): ItemRow[] {
  if (note?.startsWith(ITEM_REFUND_NOTE)) {
    const name = note.slice(ITEM_REFUND_NOTE.length);
    const named = items.filter((item) => item.cancelledAt && item.nameSnapshot === name);
    if (named.length > 0) return named;
  }
  const cancelled = items.filter((item) => item.cancelledAt);
  if (cancelled.length > 0) return cancelled;
  return items;
}

type ProductAgg = ReturnProduct & { orders: Set<string>; customers: Set<string> };
type PayoutAgg = ReturnPayout & { codes: Set<string> };

function addProduct(
  products: Map<string, ProductAgg>,
  seenItems: Set<string>,
  item: ItemRow,
  orderId: string,
  customerId: string,
): void {
  if (seenItems.has(item.id)) return;
  seenItems.add(item.id);
  const selections = itemSelections(item);
  const key = `${item.productId}:${item.nameSnapshot}:${variantKey(selections)}`;
  const product = products.get(key) ?? {
    productId: item.productId,
    name: item.nameSnapshot,
    selections,
    size: item.size,
    color: item.color,
    qty: 0,
    amount: 0,
    orderCount: 0,
    customerCount: 0,
    orders: new Set<string>(),
    customers: new Set<string>(),
  };
  product.qty += item.qty;
  product.amount += item.unitPrice * item.qty;
  product.orders.add(orderId);
  product.customers.add(customerId);
  products.set(key, product);
}

function addPayout(
  payouts: Map<string, PayoutAgg>,
  customer: CustomerRow,
  amount: number,
  qty: number,
  orderCode: string,
): void {
  if (amount <= 0 && qty <= 0) return;
  const payout = payouts.get(customer.id) ?? {
    customerId: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    bankName: customer.bankName,
    bankAccountNumber: customer.bankAccountNumber,
    bankAccountName: customer.bankAccountName,
    amount: 0,
    qty: 0,
    orderCodes: [],
    codes: new Set<string>(),
  };
  payout.amount += amount;
  payout.qty += qty;
  payout.codes.add(orderCode);
  payouts.set(customer.id, payout);
}

function finalize(products: Map<string, ProductAgg>, payouts: Map<string, PayoutAgg>) {
  const productRows = [...products.values()]
    .map(({ orders, customers, ...row }) => ({
      ...row,
      orderCount: orders.size,
      customerCount: customers.size,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'mn') || b.qty - a.qty);

  const payoutRows = [...payouts.values()]
    .map(({ codes, ...row }) => ({
      ...row,
      orderCodes: [...codes].sort(),
    }))
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email, 'mn'));

  return {
    products: productRows,
    payouts: payoutRows,
    summary: {
      qty: productRows.reduce((sum, row) => sum + row.qty, 0),
      amount: payoutRows.reduce((sum, row) => sum + row.amount, 0),
      productCount: productRows.length,
      customerCount: payoutRows.length,
    },
  };
}

/**
 * Буцаалт = захиалгын дэлгэрэнгүйгээс:
 * - мөр «Цуцлаад буцаах»
 * - «Буцаалт хийх» / QPay буцаалт (төлсөн мөнгө)
 * Захиалга бүтнээр цуцлагдсан, төлбөргүй автомат цуцлалт орохгүй.
 */
export async function returnsCalendar(year: number, month: number): Promise<{
  year: number;
  month: number;
  days: ReturnCalendarDay[];
}> {
  const payoutDays = payoutDaysInMonth(year, month);
  const windows = payoutDays.map((day) => ({ day, ...payoutWindow(day) }));
  const from = windows[0]!.gte;
  const to = windows[windows.length - 1]!.lte;

  const [refunds, cancelledItems] = await Promise.all([
    prisma.payment.findMany({
      where: adminRefundWhere({ gte: from, lte: to }),
      select: {
        id: true,
        amount: true,
        createdAt: true,
        note: true,
        order: {
          select: {
            customerId: true,
            items: { select: itemSelect },
          },
        },
      },
    }),
    prisma.orderItem.findMany({
      where: { cancelledAt: { gte: from, lte: to } },
      select: {
        ...itemSelect,
        cancelledAt: true,
        order: { select: { customerId: true } },
      },
    }),
  ]);

  const byDay = new Map<
    string,
    { qty: number; itemIds: Set<string>; customers: Set<string>; refundIds: Set<string> }
  >();
  for (const date of payoutDays) {
    byDay.set(date, {
      qty: 0,
      itemIds: new Set<string>(),
      customers: new Set<string>(),
      refundIds: new Set<string>(),
    });
  }

  const bucket = (at: Date) => byDay.get(payoutDateForReturn(at));

  for (const item of cancelledItems) {
    if (!item.cancelledAt) continue;
    const entry = bucket(item.cancelledAt);
    if (!entry) continue;
    if (!entry.itemIds.has(item.id)) {
      entry.itemIds.add(item.id);
      entry.qty += item.qty;
    }
    entry.customers.add(item.order.customerId);
  }

  for (const refund of refunds) {
    const entry = bucket(refund.createdAt);
    if (!entry) continue;
    entry.refundIds.add(refund.id);
    entry.customers.add(refund.order.customerId);
    for (const item of productsForRefund(refund.note, refund.order.items)) {
      if (entry.itemIds.has(item.id)) continue;
      entry.itemIds.add(item.id);
      entry.qty += item.qty;
    }
  }

  return {
    year,
    month,
    days: payoutDays.map((date) => {
      const v = byDay.get(date)!;
      return {
        date,
        qty: v.qty,
        itemCount: v.itemIds.size || v.refundIds.size,
        customerCount: v.customers.size,
      };
    }),
  };
}

export async function listReturns(days: string[]): Promise<{
  days: string[];
  products: ReturnProduct[];
  payouts: ReturnPayout[];
  summary: { qty: number; amount: number; productCount: number; customerCount: number };
}> {
  const uniqueDays = [...new Set(days)].sort();
  if (uniqueDays.length === 0) {
    return {
      days: [],
      products: [],
      payouts: [],
      summary: { qty: 0, amount: 0, productCount: 0, customerCount: 0 },
    };
  }

  const ranges = rangesForDays(uniqueDays);

  const [refunds, cancelledItems] = await Promise.all([
    prisma.payment.findMany({
      where: {
        kind: 'REFUND',
        actor: { startsWith: 'admin:' },
        OR: ranges.map((createdAt) => ({ createdAt })),
      },
      select: {
        amount: true,
        note: true,
        order: {
          select: {
            id: true,
            code: true,
            customer: { select: customerSelect },
            items: { select: itemSelect },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.orderItem.findMany({
      where: { OR: ranges.map((cancelledAt) => ({ cancelledAt })) },
      select: {
        ...itemSelect,
        order: {
          select: {
            id: true,
            code: true,
            customer: { select: customerSelect },
          },
        },
      },
      orderBy: { cancelledAt: 'asc' },
    }),
  ]);

  const products = new Map<string, ProductAgg>();
  const payouts = new Map<string, PayoutAgg>();
  const seenItems = new Set<string>();

  for (const item of cancelledItems) {
    addProduct(products, seenItems, item, item.order.id, item.order.customer.id);
  }

  const countedOrders = new Set<string>();
  for (const refund of refunds) {
    const linked = productsForRefund(refund.note, refund.order.items);
    let qty = 0;
    if (!countedOrders.has(refund.order.id)) {
      countedOrders.add(refund.order.id);
      qty = linked.reduce((sum, item) => sum + item.qty, 0);
    }
    for (const item of linked) {
      addProduct(products, seenItems, item, refund.order.id, refund.order.customer.id);
    }
    addPayout(payouts, refund.order.customer, refund.amount, qty, refund.order.code);
  }

  const { products: productRows, payouts: payoutRows, summary } = finalize(products, payouts);

  return { days: uniqueDays, products: productRows, payouts: payoutRows, summary };
}
