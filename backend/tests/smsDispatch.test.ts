import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SmsDispatch } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  smsDispatch: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  send: vi.fn(),
}));

vi.mock('../src/prisma.js', () => ({
  prisma: { smsDispatch: mocks.smsDispatch },
}));
vi.mock('../src/services/sms.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/sms.js')>();
  return {
    ...actual,
    smsProviderOf: () => ({ name: 'mock', tracksDelivery: true, send: mocks.send, delivery: vi.fn() }),
  };
});

import { dispatchSms } from '../src/services/smsDispatch.js';

function row(over: Partial<SmsDispatch> = {}): SmsDispatch {
  return {
    id: 'd1',
    channel: 'shop',
    purpose: 'otp_login',
    provider: 'mock',
    phone: '99112233',
    providerMessageId: null,
    status: 'pending',
    attempt: 1,
    error: null,
    relatedType: 'phone_otp',
    relatedId: 'otp-1',
    idempotencyKey: 'otp_login:phone_otp:otp-1:a1',
    checkCount: 0,
    nextCheckAt: null,
    lastCheckedAt: null,
    acceptedAt: null,
    deliveredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe('dispatchSms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.smsDispatch.findFirst.mockResolvedValue(null);
    mocks.smsDispatch.create.mockImplementation(async ({ data }) => row(data));
    mocks.smsDispatch.update.mockImplementation(async ({ data }) => row(data));
    mocks.send.mockResolvedValue({ accepted: true, status: 'queued', id: 'm1' });
  });

  it('илгээхээс өмнө бүртгэж, үр дүнг дараа шинэчилнэ', async () => {
    const order: string[] = [];
    mocks.smsDispatch.create.mockImplementation(async ({ data }) => {
      order.push('create');
      return row(data);
    });
    mocks.send.mockImplementation(async () => {
      order.push('send');
      return { accepted: true, status: 'queued', id: 'm1' };
    });
    mocks.smsDispatch.update.mockImplementation(async ({ data }) => {
      order.push('update');
      return row(data);
    });
    const result = await dispatchSms({
      channel: 'shop',
      purpose: 'otp_login',
      phone: '99112233',
      text: 'код',
      relatedType: 'phone_otp',
      relatedId: 'otp-1',
    });
    expect(order).toEqual(['create', 'send', 'update']);
    expect(result.send.status).toBe('queued');
    expect(result.skipped).toBeUndefined();
  });

  it('pending байхад давхар илгээхгүй', async () => {
    mocks.smsDispatch.findFirst.mockResolvedValue(row({ status: 'queued', providerMessageId: 'm1' }));
    const result = await dispatchSms({
      channel: 'shop',
      purpose: 'arrival',
      phone: '99112233',
      text: 'бараа',
      relatedType: 'order',
      relatedId: 'order-1',
    });
    expect(result.skipped).toBe(true);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.smsDispatch.create).not.toHaveBeenCalled();
  });

  it('resend нь шинэ оролдлого', async () => {
    mocks.smsDispatch.findFirst.mockResolvedValue(row({ attempt: 1 }));
    await dispatchSms({
      channel: 'shop',
      purpose: 'arrival',
      phone: '99112233',
      text: 'бараа',
      relatedType: 'order',
      relatedId: 'order-1',
      resend: true,
    });
    expect(mocks.smsDispatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ attempt: 2, idempotencyKey: 'arrival:order:order-1:a2' }),
    });
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it('давхар create unique бол алгасна', async () => {
    mocks.smsDispatch.create.mockRejectedValue({ code: 'P2002' });
    mocks.smsDispatch.findUnique.mockResolvedValue(row({ status: 'pending' }));
    const result = await dispatchSms({
      channel: 'shop',
      purpose: 'arrival',
      phone: '99112233',
      text: 'бараа',
      relatedType: 'order',
      relatedId: 'order-1',
    });
    expect(result.skipped).toBe(true);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
