import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productOrderDateFilters, roundBuyerCounts, filterRoundBuyers, mapProductOrderExport } from '../features/orders/productOrderView.ts';

const buyer = (overrides = {}) => ({
  orderId: 'order-1', code: 'IT-101', customer: { id: 'person-1', name: 'Болд Бат', phone: '99112233', email: null },
  selections: { 'Өнгө': 'Хар', 'Хэмжээ': 'M' }, size: 'M', color: 'Хар', cancelled: false, dueAmount: 2000,
  qty: 1, unitPrice: 1000, total: 1000, ...overrides,
});

test('date filters preserve leap days and drop impossible or repeated days', () => {
  assert.deepEqual(productOrderDateFilters('2024', '2', '31,29,28,29,0,-1,no'), { year: 2024, month: 2, days: [28, 29] });
  assert.deepEqual(productOrderDateFilters('2025', '2', '29,28'), { year: 2025, month: 2, days: [28] });
});

test('URL date filters cannot pass orphaned month/day or invalid years to the API', () => {
  for (const year of ['', 'NaN', '2019', '2101', '2026.5']) assert.deepEqual(productOrderDateFilters(year, '10', '13'), { year: null, month: null, days: [] });
  assert.deepEqual(productOrderDateFilters('2026', '13', '13'), { year: 2026, month: null, days: [] });
});

test('two variants of one unpaid order count once; cancelled and closed balances do not count as unpaid', () => {
  const rows = [buyer(), buyer({ selections: { 'Хэмжээ': 'L' } }), buyer({ orderId: 'paid', dueAmount: 0 }), buyer({ orderId: 'overpaid', dueAmount: -1000 }), buyer({ orderId: 'cancelled', cancelled: true })];
  assert.deepEqual(roundBuyerCounts(rows), { active: 3, unpaid: 1, cancelledRows: 1 });
  assert.equal(filterRoundBuyers(rows, 'unpaid', '').length, 2);
  assert.equal(filterRoundBuyers(rows, 'cancelled', '').length, 1);
  assert.equal(filterRoundBuyers(rows, 'active', '').length, 4);
});

test('buyer search matches Mongolian names, formatted phones, codes and options without losing distinct rows', () => {
  const rows = [buyer(), buyer({ selections: { 'Хэмжээ': 'L' }, size: 'L' }), buyer({ orderId: 'other', code: 'IT-202', customer: { name: 'Өөр хүн', phone: null }, color: 'Цагаан', size: 'S', selections: { 'Өнгө': 'Цагаан' } })];
  for (const query of [' БОЛД БАТ ', '(9911)-2233', 'it101', 'Хар']) assert.equal(filterRoundBuyers(rows, 'active', query).length, 2);
  const all = filterRoundBuyers(rows, 'active', '');
  const matches = filterRoundBuyers(rows, 'active', 'Хар');
  assert.equal(new Set(all.map(row => row.key)).size, 3);
  assert.deepEqual(matches.map(row => row.key), all.slice(0, 2).map(row => row.key));
  assert.equal(filterRoundBuyers(rows, 'active', 'байхгүй').length, 0);
});

test('customer export limits concurrent requests while keeping all products in their original order', async () => {
  let active = 0, peak = 0;
  const rows = Array.from({ length: 19 }, (_, index) => index);
  const output = await mapProductOrderExport(rows, async (value) => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, value % 4));
    active--;
    return 'round-' + value;
  });
  assert.equal(peak, 4);
  assert.equal(active, 0);
  assert.deepEqual(output, rows.map(value => 'round-' + value));
});

test('an export failure stops subsequent batches and never returns a partial export', async () => {
  const started = [];
  await assert.rejects(mapProductOrderExport([0, 1, 2, 3, 4, 5], async (value) => {
    started.push(value);
    if (value === 2) throw new Error('API unavailable');
    return value;
  }), /API unavailable/);
  assert.deepEqual(started, [0, 1, 2, 3]);
});
