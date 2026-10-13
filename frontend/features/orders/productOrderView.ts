import type { RoundBuyer } from '../../types/catalog';

export type BuyerScope = 'active' | 'unpaid' | 'cancelled';

/** URL filters must remain valid together, including real calendar days. */
export function productOrderDateFilters(yearRaw: string, monthRaw: string, daysRaw: string) {
  const integer = (raw: string, min: number, max: number) => /^\d+$/.test(raw) && Number(raw) >= min && Number(raw) <= max ? Number(raw) : null;
  const year = integer(yearRaw, 2020, 2100);
  const month = year === null ? null : integer(monthRaw, 1, 12);
  const lastDay = year !== null && month !== null ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  const days = [...new Set(daysRaw.split(',').map((raw) => integer(raw.trim(), 1, lastDay)).filter((day): day is number => day !== null))].sort((a, b) => a - b);
  return { year, month, days };
}

/** Several variants of one order are several rows, but one unpaid order. */
export function roundBuyerCounts(orders: RoundBuyer[]) {
  return {
    active: new Set(orders.filter((row) => !row.cancelled).map((row) => row.orderId)).size,
    unpaid: new Set(orders.filter((row) => !row.cancelled && row.dueAmount > 0).map((row) => row.orderId)).size,
    cancelledRows: orders.filter((row) => row.cancelled).length,
  };
}

export function filterRoundBuyers(orders: RoundBuyer[], scope: BuyerScope, search: string) {
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[\s()\-]/g, '');
  const query = normalize(search);
  return orders.map((buyer, index) => ({ buyer, key: `${buyer.orderId}:${index}` })).filter(({ buyer }) => {
    if (scope === 'cancelled' ? !buyer.cancelled : buyer.cancelled || (scope === 'unpaid' && buyer.dueAmount <= 0)) return false;
    const text = [buyer.code, buyer.customer.name, buyer.customer.phone, buyer.customer.email, buyer.size, buyer.color, ...Object.values(buyer.selections)].filter(Boolean).join(' ');
    return !query || normalize(text).includes(query);
  });
}

/** Customer exports should not send fifty requests to the API at once. */
export async function mapProductOrderExport<T, U>(rows: T[], load: (row: T) => Promise<U>): Promise<U[]> {
  const result: U[] = [];
  for (let start = 0; start < rows.length; start += 4) result.push(...await Promise.all(rows.slice(start, start + 4).map(load)));
  return result;
}
