import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/prisma.js';
import { seedAdmin, seedCatalog } from './helpers/seedAdmin.js';
import { startApp } from './helpers/httpApp.js';
import { mapConcurrent } from '../src/lib/mapConcurrent.js';
import { dispatchSms } from '../src/services/smsDispatch.js';
import { smsPreviewToken } from '../src/lib/smsCompose.js';

const state = vi.hoisted(() => ({ active: 0, max: 0, calls: 0 }));
vi.mock('../src/services/sms.js', async (original) => ({
  ...await original<typeof import('../src/services/sms.js')>(),
  smsProviderOf: () => ({
    name: 'mock', tracksDelivery: true,
    send: async () => {
      state.active++; state.calls++; state.max = Math.max(state.max, state.active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return { accepted: true, status: 'queued' as const, id: randomUUID() };
      } finally { state.active--; }
    },
  }),
}));

let server: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => { server = await startApp(); });
afterAll(async () => { await server.close(); });

describe('SMS performance and reliability', () => {
  it('40 recipients complete with four bounded workers; replay sends nobody twice', async () => {
    const admin = await seedAdmin('LEASING');
    const phoneBase = 98_000_000 + randomInt(0, 999_960);
    const phones = Array.from({ length: 40 }, (_, i) => String(phoneBase + i));
    const sendKey = randomUUID();
    const text = 'Performance test';
    const beforeKey = randomUUID();
    let started = performance.now();
    for (const phone of phones) await dispatchSms({ channel: 'leasing', purpose: 'leasing_custom', phone, text, relatedType: 'custom', relatedId: phone, confirmKey: beforeKey });
    const sequentialMs = Math.round(performance.now() - started);
    await prisma.smsDispatch.deleteMany({ where: { idempotencyKey: { startsWith: `confirm:leasing_custom:${beforeKey}:` } } });
    state.max = 0; state.calls = 0;
    const preview = await fetch(`${server.url}/api/leasing/sms/preview`, { method: 'POST', headers: admin.headers, body: JSON.stringify({ phones, text }) });
    expect(preview.status).toBe(200);
    const draft = await preview.json() as { data: { previewToken: string } };
    const body = JSON.stringify({ phones, text, previewToken: draft.data.previewToken, sendKey });
    started = performance.now();
    const result = await fetch(`${server.url}/api/leasing/sms`, { method: 'POST', headers: admin.headers, body });
    const concurrentMs = Math.round(performance.now() - started);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ data: { sent: 40, pending: 40, delivered: 0, failed: [] } });
    expect(state.max).toBe(4);
    expect(state.calls).toBe(40);
    expect(concurrentMs).toBeLessThan(sequentialMs * 0.65);
    expect(await prisma.smsDispatch.count({ where: { idempotencyKey: { startsWith: `confirm:leasing_custom:${sendKey}:` } } })).toBe(40);
    const retry = await fetch(`${server.url}/api/leasing/sms`, { method: 'POST', headers: admin.headers, body });
    expect(retry.status).toBe(200);
    expect(state.calls).toBe(40);
    await prisma.smsDispatch.updateMany({ where: { idempotencyKey: { startsWith: `confirm:leasing_custom:${sendKey}:` } }, data: { status: 'delivered', deliveredAt: new Date(), nextCheckAt: null } });
    const deliveredRetry = await fetch(`${server.url}/api/leasing/sms`, { method: 'POST', headers: admin.headers, body });
    expect(deliveredRetry.status).toBe(200);
    expect(await deliveredRetry.json()).toMatchObject({ data: { sent: 40, delivered: 40 } });
    expect(state.calls).toBe(40);
    console.info(`[performance] SMS 40 recipients: sequential=${sequentialMs}ms concurrent=${concurrentMs}ms maxWorkers=${state.max}; actual SMS=0`);
  }, 20_000);

  it('a failed worker does not abort remaining recipients or reorder results', async () => {
    let active = 0; let max = 0;
    const results = await mapConcurrent([0, 1, 2, 3, 4, 5], 2, async (i) => {
      active++; max = Math.max(max, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (i === 1) throw new Error('uncertain provider response');
        return i;
      } finally { active--; }
    });
    expect(max).toBe(2); expect(active).toBe(0);
    expect(results.map((r) => r.status === 'fulfilled' ? r.value : 'failed')).toEqual([0, 'failed', 2, 3, 4, 5]);
  });

  it('batch arrival chunks retain their approved text, ownership, and one send per order', async () => {
    const admin = await seedAdmin('ADMIN');
    const batch = await prisma.batch.create({ data: { name: `SMS-${randomUUID()}`, stage: 'AT_WAREHOUSE' } });
    const orders = [];
    for (let i = 0; i < 16; i++) {
      const c = await seedCatalog();
      orders.push(await prisma.order.create({ data: {
        code: `PS-${randomUUID().slice(0, 6).toUpperCase()}`, customerId: c.customer.id,
        status: 'ARRIVED', batchId: batch.id, subtotal: 20_000, paidAmount: 20_000, dueAmount: 0,
        items: { create: { productId: c.product.id, roundId: c.round.id, nameSnapshot: c.product.name, costPriceSnapshot: 10_000, unitPrice: 20_000, qty: 1, arrivedQty: 1, arrivedAt: new Date() } },
      } }));
    }
    const preview = await fetch(`${server.url}/api/admin/batches/${batch.id}/arrival-sms/preview`, { headers: admin.headers });
    expect(preview.status).toBe(200);
    const draft = await preview.json() as { data: { recipients: { orderId: string; text: string }[] } };
    expect(draft.data.recipients).toHaveLength(16);
    state.max = 0; state.calls = 0;
    const sendKey = randomUUID();
    for (let i = 0; i < 16; i += 8) {
      const chunk = draft.data.recipients.slice(i, i + 8);
      const body = { orderIds: chunk.map((r) => r.orderId), sendKey,
        previewToken: smsPreviewToken(chunk.map((r) => ({ id: r.orderId, text: r.text })), { channel: 'shop', relatedType: 'order' }) };
      const result = await fetch(`${server.url}/api/admin/batches/${batch.id}/arrival-sms`, { method: 'POST', headers: admin.headers, body: JSON.stringify(body) });
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({ data: { sent: 8, pending: 8, delivered: 0, failed: [] } });
    }
    expect(state.max).toBe(4); expect(state.calls).toBe(16);
    expect(await prisma.order.count({ where: { id: { in: orders.map((r) => r.id) }, arrivalNotifiedAt: { not: null } } })).toBe(16);
    const tampered = await fetch(`${server.url}/api/admin/batches/${batch.id}/arrival-sms`, { method: 'POST', headers: admin.headers,
      body: JSON.stringify({ orderIds: [orders[0]!.id], sendKey, previewToken: 'old-confirmation-token' }) });
    expect(tampered.status).toBe(409); expect(state.calls).toBe(16);
  });

  it('leasing reminder chunks use their confirmed subset without resending completed recipients', async () => {
    const admin = await seedAdmin('LEASING');
    const ids: string[] = [];
    for (let i = 0; i < 16; i++) {
      const c = await seedCatalog();
      const order = await prisma.order.create({ data: {
        code: `PL-${randomUUID().slice(0, 6).toUpperCase()}`, customerId: c.customer.id,
        status: 'ARRIVED', isLeasing: true, payeeKind: 'LEASING', leasingOperatorAdminId: admin.admin.id,
        subtotal: 20_000, leasingFee: 1000, paidAmount: 1000, dueAmount: 20_000,
        items: { create: { productId: c.product.id, roundId: c.round.id, nameSnapshot: c.product.name, costPriceSnapshot: 10_000, unitPrice: 20_000, qty: 1, arrivedQty: 1, arrivedAt: new Date() } },
      } }); ids.push(order.id);
    }
    const base = { kind: 'arrived_unpaid', orderIds: ids, template: 'Төлбөр {amount}' };
    const preview = await fetch(`${server.url}/api/leasing/orders/sms-reminders/preview`, { method: 'POST', headers: admin.headers, body: JSON.stringify(base) });
    expect(preview.status).toBe(200);
    const draft = await preview.json() as { data: { recipients: { orderId: string; text: string }[] } };
    expect(draft.data.recipients).toHaveLength(16);
    state.max = 0; state.calls = 0;
    const sendKey = randomUUID();
    for (let i = 0; i < 16; i += 8) {
      const chunk = draft.data.recipients.slice(i, i + 8);
      const body = { ...base, orderIds: chunk.map((r) => r.orderId), sendKey,
        previewToken: smsPreviewToken(chunk.map((r) => ({ id: r.orderId, text: r.text })), { channel: 'leasing', relatedType: 'order' }) };
      const result = await fetch(`${server.url}/api/leasing/orders/sms-reminders`, { method: 'POST', headers: admin.headers, body: JSON.stringify(body) });
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({ data: { sent: 8, pending: 8, delivered: 0, failed: [] } });
      const replay = await fetch(`${server.url}/api/leasing/orders/sms-reminders`, { method: 'POST', headers: admin.headers, body: JSON.stringify(body) });
      expect(replay.status).toBe(200);
    }
    expect(state.max).toBe(4); expect(state.calls).toBe(16);
  });
});
