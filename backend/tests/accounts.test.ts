import type { Request, Response, Router } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  customer: {
    findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  emailOtp: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  sendMail: vi.fn(),
}));
vi.mock('../src/prisma.js', () => ({ prisma: mocks }));
vi.mock('../src/services/mail.js', () => ({
  sendMail: mocks.sendMail,
  mailTemplates: { verify: (code: string) => ({ subject: 'verify', text: code, html: code }) },
}));
vi.mock('../src/lib/jwt.js', () => ({ signCustomerToken: () => 'new-session-token' }));
vi.mock('../src/middleware/auth.js', () => ({ requireCustomer: vi.fn() }));
vi.mock('bcryptjs', () => ({ default: { compare: async () => true } }));

import { publicMeRouter } from '../src/routes/public/me.js';
import { publicAuthRouter } from '../src/routes/public/auth.js';
import { adminCustomersRouter } from '../src/routes/admin/customers.js';
import { leasingCustomersRouter } from '../src/routes/leasing/customers.js';
import { issueEmailChange, verifyEmailChange } from '../src/services/emailChange.js';

type Row = Record<string, any>;
let customer: Row;
let otps: Row[];
let transactionQueue: Promise<unknown>;
let occupiedEmail: string | null;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === 'object') {
      if ('lt' in value) return row[key] < value.lt;
      if ('gt' in value) return row[key] > value.gt;
    }
    return row[key] === value;
  });
}

function apply(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    row[key] = value !== null && typeof value === 'object' && 'increment' in value
      ? row[key] + value.increment
      : value;
  }
}

/** Run the real route validation and handler without sockets, auth, DB, or mail. */
function invoke(router: Router, method: string, path: string, body: Row): Promise<any> {
  const route = (router as any).stack.find((layer: any) =>
    layer.route?.path === path && layer.route.methods[method],
  ).route;
  return new Promise((resolve, reject) => {
    const req = { body, params: { id: customer.id }, auth: { sub: customer.id } } as unknown as Request;
    const res = { json: resolve } as unknown as Response;
    let index = 0;
    const next = (error?: unknown) => {
      if (error) return reject(error);
      route.stack[index++].handle(req, res, next);
    };
    next();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  customer = {
    id: 'customer-1', email: 'old@example.com', phone: '99112233', name: 'Customer',
    passwordHash: 'hash', emailVerifiedAt: new Date('2026-01-01'), createdAt: new Date('2026-01-01'),
    district: null, khoroo: null, addressText: null,
    notifyPayment: true, notifyArrival: true, notifyPromo: false,
    bankName: '', bankAccountNumber: '', bankAccountName: '', defaultPayoutBank: false,
  };
  otps = [];
  occupiedEmail = null;
  transactionQueue = Promise.resolve();
  mocks.sendMail.mockResolvedValue({ ok: true });
  mocks.customer.findUnique.mockImplementation(async ({ where }) => {
    if (where.email && where.email === occupiedEmail) return { ...customer, id: 'other', email: occupiedEmail };
    return matches(customer, where) ? { ...customer } : null;
  });
  mocks.customer.findFirst.mockImplementation(async ({ where }) => where.id === customer.id ? { ...customer } : null);
  mocks.customer.findUniqueOrThrow.mockImplementation(async () => ({ ...customer }));
  mocks.customer.update.mockImplementation(async ({ data }) => {
    apply(customer, data);
    return { ...customer };
  });
  mocks.customer.updateMany.mockImplementation(async ({ where, data }) => {
    if (!matches(customer, where)) return { count: 0 };
    apply(customer, data);
    return { count: 1 };
  });
  mocks.emailOtp.findFirst.mockImplementation(async ({ where }) =>
    otps.filter((row) => matches(row, where)).at(-1) ?? null,
  );
  mocks.emailOtp.create.mockImplementation(async ({ data }) => {
    const row = { id: `otp-${otps.length + 1}`, createdAt: new Date(), usedAt: null, attempts: 0, ...data };
    otps.push(row);
    return { ...row };
  });
  mocks.emailOtp.updateMany.mockImplementation(async ({ where, data }) => {
    const rows = otps.filter((row) => matches(row, where));
    rows.forEach((row) => apply(row, data));
    return { count: rows.length };
  });
  mocks.emailOtp.update.mockImplementation(async ({ where, data }) => {
    const row = otps.find((row) => matches(row, where))!;
    apply(row, data);
    return row;
  });
  mocks.$queryRaw.mockImplementation(async (_sql, id, email) =>
    customer.id === id && (email === undefined || customer.email === email) ? [{ id }] : [],
  );
  mocks.$transaction.mockImplementation((callback) => {
    const pending = transactionQueue.then(async () => {
      const before = structuredClone({ customer, otps });
      try { return await callback(mocks); }
      catch (error) {
        customer = before.customer;
        otps = before.otps;
        throw error;
      }
    });
    transactionQueue = pending.catch(() => undefined);
    return pending;
  });
});

describe('customer partial updates', () => {
  it.each([
    ['profile notifications', publicMeRouter, '/', { notifyPromo: true }],
    ['profile bank details', publicMeRouter, '/', { bankName: 'Bank' }],
    ['admin name', adminCustomersRouter, '/:id', { name: 'Updated' }],
    ['leasing address', leasingCustomersRouter, '/:id', { district: 'Updated' }],
  ] as const)('%s preserves an omitted phone', async (_name, router, path, body) => {
    await invoke(router, 'patch', path, body);
    expect(customer.phone).toBe('99112233');
    expect(mocks.customer.update.mock.calls[0]![0].data).not.toHaveProperty('phone');
  });

  it.each([null, ''])('still permits explicitly clearing phone with %s', async (phone) => {
    await invoke(publicMeRouter, 'patch', '/', { phone });
    expect(customer.phone).toBeNull();
  });

  it('still normalizes an explicitly supplied phone', async () => {
    await invoke(publicMeRouter, 'patch', '/', { phone: '+976 8811 2233' });
    expect(customer.phone).toBe('88112233');
  });
});

describe('email changes', () => {
  it('preserves ordinary account verification even when an abandoned change targets that address', async () => {
    customer.emailVerifiedAt = null;
    otps.push({
      id: 'ordinary', email: customer.email, purpose: 'VERIFY', code: '123456',
      createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000), usedAt: null, attempts: 0,
    }, {
      id: 'abandoned', email: customer.email, purpose: 'CHANGE_EMAIL', code: '654321',
      createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000), usedAt: null, attempts: 0,
      customerId: 'other', previousEmail: 'other@example.com',
    });
    const response = await invoke(publicAuthRouter, 'post', '/email/verify', {
      email: customer.email, code: '123456',
    });
    expect(response.data.customer.emailVerified).toBe(true);
    expect(customer.email).toBe('old@example.com');
    expect(otps[1]!.usedAt).toBeNull();
  });

  it('keeps the original login address and verification state when delivery fails', async () => {
    mocks.sendMail.mockResolvedValue({ ok: false, error: 'Mail unavailable' });
    await expect(invoke(publicMeRouter, 'post', '/email/change', {
      email: 'new@example.com', password: 'password',
    })).rejects.toMatchObject({ status: 400 });
    expect(customer.email).toBe('old@example.com');
    expect(customer.emailVerifiedAt).toEqual(new Date('2026-01-01'));
    expect(otps).toHaveLength(0);
    expect(mocks.customer.update).not.toHaveBeenCalled();
  });

  it('keeps the current address until the existing verify endpoint accepts the new-address OTP', async () => {
    const requested = await invoke(publicMeRouter, 'post', '/email/change', {
      email: ' NEW@example.com ', password: 'password',
    });
    expect(requested.data).toMatchObject({ email: 'new@example.com', resendAfterSec: 60 });
    expect(customer.email).toBe('old@example.com');
    expect(otps[0]).toMatchObject({
      customerId: customer.id, previousEmail: 'old@example.com', purpose: 'CHANGE_EMAIL',
    });
    const verified = await invoke(publicAuthRouter, 'post', '/email/verify', {
      email: 'new@example.com', code: otps[0]!.code,
    });
    expect(verified.data).toMatchObject({ token: 'new-session-token', customer: { email: 'new@example.com', emailVerified: true } });
    expect(customer.email).toBe('new@example.com');
    expect(otps[0]!.usedAt).toBeInstanceOf(Date);
  });

  it('resends pending changes through the existing endpoint without changing the account', async () => {
    await issueEmailChange(customer as any, 'new@example.com');
    otps[0]!.createdAt = new Date(Date.now() - 61_000);
    const response = await invoke(publicAuthRouter, 'post', '/email/resend', { email: 'new@example.com' });
    expect(response.data.email).toBe('new@example.com');
    expect(mocks.sendMail).toHaveBeenCalledTimes(2);
    expect(mocks.sendMail.mock.calls[1]![0]).toMatchObject({ to: 'new@example.com', text: otps[0]!.code });
    expect(customer.email).toBe('old@example.com');
  });

  it('rejects wrong and expired codes without changing the email', async () => {
    await issueEmailChange(customer as any, 'new@example.com');
    await expect(verifyEmailChange(otps[0] as any, '000000')).rejects.toMatchObject({ status: 401 });
    expect(otps[0]!.attempts).toBe(1);
    otps[0]!.expiresAt = new Date(Date.now() - 1);
    await expect(verifyEmailChange(otps[0] as any, otps[0]!.code)).rejects.toMatchObject({ status: 400 });
    expect(customer.email).toBe('old@example.com');
  });

  it('rolls back OTP consumption if the new address becomes occupied', async () => {
    await issueEmailChange(customer as any, 'new@example.com');
    occupiedEmail = 'new@example.com';
    await expect(verifyEmailChange(otps[0] as any, otps[0]!.code)).rejects.toMatchObject({ status: 409 });
    expect(customer.email).toBe('old@example.com');
    expect(otps[0]!.usedAt).toBeNull();
  });

  it('rejects an old request if the account address changed in the meantime', async () => {
    await issueEmailChange(customer as any, 'new@example.com');
    customer.email = 'admin-updated@example.com';
    await expect(verifyEmailChange(otps[0] as any, otps[0]!.code)).rejects.toMatchObject({ status: 409 });
    expect(customer.email).toBe('admin-updated@example.com');
    expect(otps[0]!.usedAt).toBeNull();
  });

  it('invalidates a replaced request and accepts only the latest change', async () => {
    await issueEmailChange(customer as any, 'first@example.com');
    const first = { ...otps[0] };
    await issueEmailChange(customer as any, 'second@example.com');
    await expect(verifyEmailChange(first as any, first.code)).rejects.toMatchObject({ status: 400 });
    expect(customer.email).toBe('old@example.com');
    await verifyEmailChange(otps[1] as any, otps[1]!.code);
    expect(customer.email).toBe('second@example.com');
  });

  it('consumes the same change once under simultaneous verification', async () => {
    await issueEmailChange(customer as any, 'new@example.com');
    const pending = { ...otps[0] };
    const results = await Promise.allSettled([
      verifyEmailChange(pending as any, pending.code),
      verifyEmailChange(pending as any, pending.code),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(mocks.customer.updateMany).toHaveBeenCalledTimes(1);
  });
});
