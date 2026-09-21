import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SmsDispatch } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  smsDispatch: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  delivery: vi.fn(),
  send: vi.fn(),
}));

vi.mock('../src/prisma.js', () => ({
  prisma: { smsDispatch: mocks.smsDispatch },
}));
vi.mock('../src/services/sms.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/sms.js')>();
  return {
    ...actual,
    smsProviderOf: () => ({
      name: 'callpro',
      tracksDelivery: true,
      send: mocks.send,
      delivery: mocks.delivery,
    }),
  };
});

import { pollSmsDeliveries, SMS_DELIVERY_WINDOW_MS } from '../src/services/smsDeliveryJob.js';

function row(over: Partial<SmsDispatch> = {}): SmsDispatch {
  return {
    id: 'd1',
    channel: 'shop',
    purpose: 'otp_login',
    provider: 'callpro',
    phone: '99112233',
    providerMessageId: 'm1',
    status: 'queued',
    attempt: 1,
    error: null,
    relatedType: 'phone_otp',
    relatedId: 'otp-1',
    idempotencyKey: 'k1',
    checkCount: 0,
    nextCheckAt: new Date('2026-09-16T00:00:00Z'),
    lastCheckedAt: null,
    acceptedAt: new Date('2026-09-16T00:00:00Z'),
    deliveredAt: null,
    createdAt: new Date('2026-09-16T00:00:00Z'),
    updatedAt: new Date('2026-09-16T00:00:00Z'),
    ...over,
  };
}

describe('sms delivery job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.smsDispatch.updateMany.mockResolvedValue({ count: 1 });
    mocks.smsDispatch.update.mockResolvedValue({});
    mocks.send.mockResolvedValue({ accepted: true, status: 'queued', id: 'm1' });
  });

  it('queued → delivered', async () => {
    mocks.smsDispatch.findMany.mockResolvedValue([row()]);
    mocks.delivery.mockResolvedValue({ status: 'delivered' });
    const result = await pollSmsDeliveries(new Date('2026-09-16T00:01:00Z'));
    expect(result).toEqual({ checked: 1, delivered: 1 });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.smsDispatch.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: expect.objectContaining({ status: 'delivered', nextCheckAt: null }),
    });
  });

  it('10 секундээс хожуу delivered', async () => {
    mocks.smsDispatch.findMany.mockResolvedValue([
      row({ createdAt: new Date('2026-09-16T00:00:00Z'), checkCount: 3 }),
    ]);
    mocks.delivery.mockResolvedValue({ status: 'delivered' });
    const result = await pollSmsDeliveries(new Date('2026-09-16T00:00:45Z'));
    expect(result.delivered).toBe(1);
  });

  it('status 500 дараа delivered', async () => {
    mocks.smsDispatch.findMany.mockResolvedValue([row()]);
    mocks.delivery.mockResolvedValueOnce({ status: 'unknown', error: 'HTTP 500' });
    await pollSmsDeliveries(new Date('2026-09-16T00:01:00Z'));
    expect(mocks.smsDispatch.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: expect.objectContaining({ status: 'unknown' }),
    });

    mocks.delivery.mockResolvedValueOnce({ status: 'delivered' });
    await pollSmsDeliveries(new Date('2026-09-16T00:02:00Z'));
    expect(mocks.smsDispatch.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: expect.objectContaining({ status: 'delivered' }),
    });
  });

  it('timeout-ийг failed гэж үзэхгүй', async () => {
    mocks.smsDispatch.findMany.mockResolvedValue([row()]);
    mocks.delivery.mockResolvedValue({ status: 'unknown', error: 'SMS хүсэлт timeout.' });
    await pollSmsDeliveries(new Date('2026-09-16T00:01:00Z'));
    const data = mocks.smsDispatch.update.mock.calls[0]![0].data as { status: string };
    expect(data.status).toBe('unknown');
    expect(data.status).not.toBe('failed');
  });

  it('эцсийн failed зөвхөн провайдер баталсан үед', async () => {
    mocks.smsDispatch.findMany.mockResolvedValue([row()]);
    mocks.delivery.mockResolvedValue({ status: 'failed', error: 'Unauthorized' });
    await pollSmsDeliveries(new Date('2026-09-16T00:01:00Z'));
    expect(mocks.smsDispatch.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: expect.objectContaining({ status: 'failed' }),
    });
  });

  it('хуримтлагдсан ажлыг нэг дуудлагад багтаан шалгана', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => row({ id: `d${i + 1}`, providerMessageId: `m${i + 1}` }));
    mocks.smsDispatch.findMany.mockImplementation(async ({ take }: { take: number }) => rows.splice(0, take));
    mocks.delivery.mockResolvedValue({ status: 'delivered' });
    const result = await pollSmsDeliveries(new Date('2026-09-16T00:01:00Z'), 60_000);
    expect(result.checked).toBe(20);
    expect(result.delivered).toBe(20);
    expect(mocks.smsDispatch.findMany.mock.calls.length).toBeGreaterThan(1);
  });

  it('цонх дууссан ч delivered биш бол unknown', async () => {
    const createdAt = new Date('2026-09-15T00:00:00Z');
    mocks.smsDispatch.findMany.mockResolvedValue([row({ createdAt, checkCount: 19 })]);
    mocks.delivery.mockResolvedValue({ status: 'pending' });
    const now = new Date(createdAt.getTime() + SMS_DELIVERY_WINDOW_MS + 1000);
    await pollSmsDeliveries(now);
    expect(mocks.smsDispatch.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: expect.objectContaining({ status: 'unknown', nextCheckAt: null }),
    });
  });

  it('зэрэг worker нэг мөрийг хоёр удаа шалгахгүй', async () => {
    mocks.smsDispatch.findMany.mockResolvedValue([row()]);
    mocks.smsDispatch.updateMany.mockResolvedValue({ count: 0 });
    const result = await pollSmsDeliveries(new Date('2026-09-16T00:01:00Z'));
    expect(result.checked).toBe(1);
    expect(mocks.delivery).not.toHaveBeenCalled();
  });

  it('хуучин OTP-ийн тайлан өөр мөрийг өөрчлөхгүй', async () => {
    mocks.smsDispatch.findMany.mockResolvedValue([row({ id: 'old', relatedId: 'otp-old' })]);
    mocks.delivery.mockResolvedValue({ status: 'delivered' });
    await pollSmsDeliveries(new Date('2026-09-16T00:01:00Z'));
    expect(mocks.smsDispatch.update).toHaveBeenCalledWith({
      where: { id: 'old' },
      data: expect.objectContaining({ status: 'delivered' }),
    });
    expect(mocks.smsDispatch.update.mock.calls.every((c) => c[0].where.id !== 'otp-new')).toBe(true);
  });
});
