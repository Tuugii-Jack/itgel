import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/prisma.js';
import { seedAdmin, seedCatalog } from './helpers/seedAdmin.js';
import { startApp } from './helpers/httpApp.js';
let server: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => { server = await startApp(); });
afterAll(async () => { await server?.close(); });
async function fixture() {
  const catalog = await seedCatalog();
  await prisma.productRound.update({ where: { id: catalog.round.id }, data: { closeAt: new Date(Date.now() + 86_400_000) } });
  return catalog;
}
async function submit(body: unknown, role: 'ADMIN' | 'STAFF' = 'ADMIN') {
  const admin = await seedAdmin(role);
  const response = await fetch(server.url + '/api/admin/orders', { method: 'POST', headers: admin.headers, body: JSON.stringify(body) });
  return { status: response.status, json: await response.json() };
}
describe('админы хялбар захиалга үүсгэх', () => {
  it('утас дангаар шинэ хэрэглэгч үүсгэж, анхдагчаар орлого бүртгэхгүй', async () => {
    const seed = await fixture(); const phone = seed.customer.phone!;
    await prisma.customer.update({ where: { id: seed.customer.id }, data: { phone: null } });
    const result = await submit({ phone, name: 'Утасны хэрэглэгч', items: [{ productId: seed.round.id, qty: 1 }] });
    expect(result.status).toBe(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: result.json.data.id }, include: { customer: true, payments: true } });
    expect(order.customer.phone).toBe(phone); expect(order.customer.email).toBeNull();
    expect(order.status).toBe('NEW'); expect(order.paidAmount).toBe(0); expect(order.payments).toHaveLength(0);
  });
  it('өмнө бүртгэгдсэн утсыг дахин хэрэглэгч үүсгэлгүй ашиглана', async () => {
    const seed = await fixture();
    const result = await submit({ phone: seed.customer.phone, items: [{ productId: seed.round.id, qty: 1 }] });
    expect(result.status).toBe(201);
    expect(result.json.data.customer.id).toBe(seed.customer.id);
    expect(await prisma.customer.count({ where: { phone: seed.customer.phone } })).toBe(1);
  });
  it('утас ба и-мэйл өөр бүртгэл заахад нийлүүлж захиалга үүсгэхгүй', async () => {
    const seed = await fixture();
    const other = await prisma.customer.create({ data: { email: randomUUID() + '@ui.itgel.test' } });
    const result = await submit({ email: other.email, phone: seed.customer.phone, items: [{ productId: seed.round.id, qty: 1 }] });
    expect(result.status).toBe(409);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: seed.customer.id } })).email).toBeNull();
    expect(await prisma.order.count({ where: { customerId: other.id } })).toBe(0);
  });
  it('бэлэн төлбөрийг тодорхой сонгосон үед л бүртгэнэ', async () => {
    const seed = await fixture();
    const result = await submit({ customerId: seed.customer.id, status: 'CONFIRMED', markPaid: true, items: [{ productId: seed.round.id, qty: 1 }] });
    expect(result.status).toBe(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: result.json.data.id }, include: { payments: true } });
    expect(order.paidAmount).toBe(order.subtotal); expect(order.payments).toHaveLength(1);
    expect(order.payments[0].method).toBe('CASH');
  });
  it('туслах админд үүсгэх эрх олгохгүй, холбоо барихгүй хүсэлтийг хориглоно', async () => {
    const seed = await fixture();
    const body = { customerId: seed.customer.id, items: [{ productId: seed.round.id, qty: 1 }] };
    expect((await submit(body, 'STAFF')).status).toBe(403);
    expect((await submit({ items: body.items })).status).toBe(400);
  });
});
