import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/prisma.js';
import { parseUbDay } from '../src/lib/date.js';
import { seedAdmin, seedCatalog } from './helpers/seedAdmin.js';
import { startApp } from './helpers/httpApp.js';

let server: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => { server = await startApp(); });
afterAll(async () => { await server.close(); });
async function fixture() {
  const shop = await seedCatalog(); const lease = await seedCatalog(); const admin = await seedAdmin('ADMIN');
  await prisma.product.update({ where: { id: lease.product.id }, data: { name: shop.product.name + ' lease', ownerKind: 'LEASING' } });
  await prisma.productRound.update({ where: { id: lease.round.id }, data: { ownerKind: 'LEASING', closeAt: parseUbDay('2099-12-31') } });
  await prisma.productRound.update({ where: { id: shop.round.id }, data: { closeAt: parseUbDay('2028-06-01') } });
  return { shop, lease, admin };
}
async function order(f: Awaited<ReturnType<typeof seedCatalog>>, qty = 1, extra: { isLeasing?: boolean; status?: 'NEW' | 'CANCELLED'; deletedAt?: Date; cancelledAt?: Date } = {}) {
  return prisma.order.create({ data: {
    code: 'BP-' + randomUUID().slice(0, 8).toUpperCase(), customerId: f.customer.id,
    subtotal: qty * 20_000, dueAmount: qty * 20_000 + (extra.isLeasing ? 2000 : 0),
    leasingFee: extra.isLeasing ? 2000 : 0, isLeasing: extra.isLeasing ?? false,
    status: extra.status ?? 'NEW', deletedAt: extra.deletedAt,
    items: { create: { productId: f.product.id, roundId: f.round.id, nameSnapshot: f.product.name, qty, unitPrice: 20_000, costPriceSnapshot: 10_000, cancelledAt: extra.cancelledAt } },
  } });
}
async function get<T>(headers: Record<string, string>, path: string) {
  const response = await fetch(server.url + '/api/admin' + path, { headers });
  expect(response.status).toBe(200);
  return await response.json() as { data: T; meta?: { total: number; pages: number } };
}
type Row = { roundId: string; qty: number; revenue: number; orderCount: number; byVariant: { qty: number }[] };
describe('Бараагаар захиалга — нээгдэх гаргалт ба нийцсэн тоо', () => {
  it('lists shop-owned rounds only, and list/detail exclude fee-held, deleted and cancelled quantities consistently', async () => {
    const f = await fixture();
    await order(f.shop, 3); await order(f.lease, 7);
    const held = await order(f.shop, 2, { isLeasing: true });
    await order(f.shop, 3, { status: 'CANCELLED' });
    await order(f.shop, 1, { cancelledAt: new Date() });
    await order(f.shop, 4, { deletedAt: new Date() });
    const path = '/orders/by-product?closed=all&q=' + encodeURIComponent(f.shop.product.name);
    const list = await get<Row[]>(f.admin.headers, path);
    expect(list.meta!.total).toBe(1); expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ roundId: f.shop.round.id, qty: 3, revenue: 60_000, orderCount: 1 });
    const detail = await get<{ summary: { qty: number; revenue: number; cancelledCount: number }; orders: { orderId: string }[] }>(f.admin.headers, '/rounds/' + f.shop.round.id + '/orders');
    expect(detail.data.summary).toMatchObject({ qty: 3, revenue: 60_000, cancelledCount: 2 });
    expect(detail.data.orders.some(row => row.orderId === held.id)).toBe(false);
    await prisma.payment.create({ data: { orderId: held.id, kind: 'PAYMENT', amount: 2000, method: 'QPAY', payeeKind: 'LEASING', actor: 'system' } });
    await prisma.order.update({ where: { id: held.id }, data: { status: 'CONFIRMED', paidAmount: 2000, dueAmount: 40_000 } });
    const paidList = await get<Row[]>(f.admin.headers, path);
    const paidDetail = await get<{ summary: { qty: number; revenue: number } }>(f.admin.headers, '/rounds/' + f.shop.round.id + '/orders');
    expect(paidList.data[0]).toMatchObject({ qty: 5, revenue: 100_000, orderCount: 2 });
    expect(paidDetail.data.summary).toMatchObject({ qty: 5, revenue: 100_000 });
  });
  it('the date picker and calendar-filtered list also exclude leasing-owned rounds', async () => {
    const f = await fixture(); await order(f.shop); await order(f.lease);
    const dates = await get<{ date: string }[]>(f.admin.headers, '/orders/by-product/dates?closed=open');
    expect(dates.data.some(row => row.date === '2028-06-01')).toBe(true);
    expect(dates.data.some(row => row.date === '2099-12-31')).toBe(false);
    const list = await get<Row[]>(f.admin.headers, '/orders/by-product?closed=all&year=2099&month=12&days=31&q=' + encodeURIComponent(f.shop.product.name));
    expect(list.data).toEqual([]); expect(list.meta!.total).toBe(0);
  });
  it('equal close and creation dates have stable pagination without duplicate rounds', async () => {
    const f = await seedCatalog(); const admin = await seedAdmin('ADMIN');
    const createdAt = parseUbDay('2026-01-01'); const closeAt = parseUbDay('2028-01-01');
    await prisma.productRound.update({ where: { id: f.round.id }, data: { createdAt, closeAt } }); await order(f);
    for (const roundNo of [2, 3]) {
      const round = await prisma.productRound.create({ data: { productId: f.product.id, roundNo, costPrice: 10_000, sellPrice: 20_000, status: 'ACTIVE', createdAt, closeAt } });
      await order({ ...f, round });
    }
    const ids = [];
    for (const page of [1, 2, 3]) {
      const list = await get<Row[]>(admin.headers, '/orders/by-product?closed=all&pageSize=1&page=' + page + '&q=' + encodeURIComponent(f.product.name));
      expect(list.meta!.total).toBe(3); expect(list.meta!.pages).toBe(3); ids.push(list.data[0]!.roundId);
    }
    expect(new Set(ids).size).toBe(3); expect(ids).toEqual([...ids].sort().reverse());
  });
});
