import { prisma } from '../prisma.js';
import { addUbMonths, endOfUbDay, parseUbDay, startOfUbDay, startOfUbMonth, ubDateString } from '../lib/date.js';
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
  return [...new Set(days)].sort().map((day) => {
    const parsed = parseUbDay(day);
    return { gte: startOfUbDay(parsed), lte: endOfUbDay(parsed) };
  });
}

const itemInclude = {
  order: {
    select: {
      id: true,
      code: true,
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          bankName: true,
          bankAccountNumber: true,
          bankAccountName: true,
        },
      },
    },
  },
} as const;

export async function returnsCalendar(year: number, month: number): Promise<{
  year: number;
  month: number;
  days: ReturnCalendarDay[];
}> {
  const from = startOfUbMonth(parseUbDay(`${year}-${String(month).padStart(2, '0')}-01`));
  const to = addUbMonths(from, 1);

  const items = await prisma.orderItem.findMany({
    where: { cancelledAt: { gte: from, lt: to } },
    select: {
      qty: true,
      cancelledAt: true,
      order: { select: { customerId: true } },
    },
  });

  const byDay = new Map<string, { qty: number; itemCount: number; customers: Set<string> }>();
  for (const item of items) {
    if (!item.cancelledAt) continue;
    const date = ubDateString(item.cancelledAt);
    const entry = byDay.get(date) ?? { qty: 0, itemCount: 0, customers: new Set<string>() };
    entry.qty += item.qty;
    entry.itemCount += 1;
    entry.customers.add(item.order.customerId);
    byDay.set(date, entry);
  }

  return {
    year,
    month,
    days: [...byDay.entries()]
      .map(([date, v]) => ({
        date,
        qty: v.qty,
        itemCount: v.itemCount,
        customerCount: v.customers.size,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
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

  const items = await prisma.orderItem.findMany({
    where: { OR: rangesForDays(uniqueDays).map((range) => ({ cancelledAt: range })) },
    include: itemInclude,
    orderBy: { cancelledAt: 'asc' },
  });

  const products = new Map<
    string,
    ReturnProduct & { orders: Set<string>; customers: Set<string> }
  >();
  const payouts = new Map<
    string,
    ReturnPayout & { codes: Set<string> }
  >();

  for (const item of items) {
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
    product.orders.add(item.order.id);
    product.customers.add(item.order.customer.id);
    products.set(key, product);

    const customer = item.order.customer;
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
    payout.amount += item.unitPrice * item.qty;
    payout.qty += item.qty;
    payout.codes.add(item.order.code);
    payouts.set(customer.id, payout);
  }

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

  const qty = productRows.reduce((sum, row) => sum + row.qty, 0);
  const amount = productRows.reduce((sum, row) => sum + row.amount, 0);

  return {
    days: uniqueDays,
    products: productRows,
    payouts: payoutRows,
    summary: {
      qty,
      amount,
      productCount: productRows.length,
      customerCount: payoutRows.length,
    },
  };
}
