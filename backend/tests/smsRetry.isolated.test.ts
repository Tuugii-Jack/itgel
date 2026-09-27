import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/prisma.js';
import { dispatchSms } from '../src/services/smsDispatch.js';

describe('FAILED SMS retry — атомик эзэмшил', () => {
  it('ижил failed confirmation-ийг зэрэг retry хийхэд provider нэг удаа', async () => {
    const phone = `99${randomUUID().replace(/\D/g, '').slice(0, 6).padEnd(6, '0')}`;
    const confirmKey = `ck-${randomUUID()}`;
    const relatedId = `order-${randomUUID().slice(0, 8)}`;
    await prisma.smsDispatch.create({
      data: {
        channel: 'shop',
        purpose: 'arrival',
        provider: 'test',
        phone,
        status: 'failed',
        providerMessageId: 'm-old',
        relatedType: 'order',
        relatedId,
        idempotencyKey: `confirm:arrival:${confirmKey}:${relatedId}`,
        attempt: 1,
        checkCount: 2,
        error: 'old fail',
      },
    });

    let sends = 0;
    const provider = {
      name: 'test',
      tracksDelivery: true,
      send: async () => {
        sends += 1;
        await new Promise((resolve) => setTimeout(resolve, 80));
        return { accepted: true, status: 'queued' as const, id: 'm-new' };
      },
    };

    const [a, b] = await Promise.all([
      dispatchSms({
        channel: 'shop',
        purpose: 'arrival',
        phone,
        text: 'бараа ирлээ',
        relatedType: 'order',
        relatedId,
        confirmKey,
        provider,
      }),
      dispatchSms({
        channel: 'shop',
        purpose: 'arrival',
        phone,
        text: 'бараа ирлээ',
        relatedType: 'order',
        relatedId,
        confirmKey,
        provider,
      }),
    ]);
    expect(sends).toBe(1);
    expect([a.skipped, b.skipped].filter(Boolean)).toHaveLength(1);
    const winner = a.skipped ? b : a;
    expect(winner.dispatch.providerMessageId).toBe('m-new');
    expect(winner.dispatch.attempt).toBe(2);
    expect(winner.dispatch.checkCount).toBe(2);
    const row = await prisma.smsDispatch.findFirstOrThrow({
      where: { idempotencyKey: `confirm:arrival:${confirmKey}:${relatedId}` },
    });
    expect(row.providerMessageId).toBe('m-new');
    expect(row.attempt).toBe(2);
  });

  it('claim хийсний дараа тасарвал pending-ийг failed болгож дахин send хийхгүй', async () => {
    const phone = `98${randomUUID().replace(/\D/g, '').slice(0, 6).padEnd(6, '0')}`;
    const confirmKey = `ck-${randomUUID()}`;
    const relatedId = `order-${randomUUID().slice(0, 8)}`;
    await prisma.smsDispatch.create({
      data: {
        channel: 'shop',
        purpose: 'arrival',
        provider: 'test',
        phone,
        status: 'pending',
        providerMessageId: 'm-old',
        relatedType: 'order',
        relatedId,
        idempotencyKey: `confirm:arrival:${confirmKey}:${relatedId}`,
        attempt: 2,
        checkCount: 2,
        error: 'old fail',
      },
    });
    let sends = 0;
    const result = await dispatchSms({
      channel: 'shop',
      purpose: 'arrival',
      phone,
      text: 'бараа ирлээ',
      relatedType: 'order',
      relatedId,
      confirmKey,
      provider: {
        name: 'test',
        tracksDelivery: true,
        send: async () => {
          sends += 1;
          return { accepted: true, status: 'queued' as const, id: 'm-new' };
        },
      },
    });
    expect(result.skipped).toBe(true);
    expect(sends).toBe(0);
    expect(result.dispatch.status).toBe('pending');
    expect(result.dispatch.providerMessageId).toBe('m-old');
  });
});
