import type { Request, Response, Router } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  customer: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  hash: vi.fn(async () => 'hashed'),
  compare: vi.fn(async () => true),
}));

vi.mock('../src/prisma.js', () => ({ prisma: { customer: mocks.customer } }));
vi.mock('../src/lib/jwt.js', () => ({ signCustomerToken: () => 'token' }));
vi.mock('bcryptjs', () => ({
  default: { hash: mocks.hash, compare: mocks.compare },
}));

import { publicAuthRouter } from '../src/routes/public/auth.js';

type Row = Record<string, unknown>;

function invoke(router: Router, method: string, path: string, body: Row): Promise<any> {
  const route = (router as any).stack.find(
    (layer: any) => layer.route?.path === path && layer.route.methods[method],
  ).route;
  return new Promise((resolve, reject) => {
    const req = { body, ip: '127.0.0.1' } as unknown as Request;
    const res = {
      status() {
        return this;
      },
      json: resolve,
    } as unknown as Response;
    let index = 0;
    const next = (error?: unknown) => {
      if (error) return reject(error);
      route.stack[index++].handle(req, res, next);
    };
    next();
  });
}

describe('утасны бүртгэл / нэвтрэлт', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.customer.findUnique.mockResolvedValue(null);
    mocks.customer.findFirst.mockResolvedValue(null);
    mocks.customer.create.mockImplementation(async ({ data }) => ({
      id: 'c1',
      emailVerifiedAt: new Date(),
      ...data,
    }));
  });

  it('register бусдын дугаарыг нэвтрэх эрх болгож хадгалахгүй', async () => {
    const response = await invoke(publicAuthRouter, 'post', '/register', {
      email: 'attacker@example.com',
      password: 'secret1',
      phone: '99112233',
      name: 'Attacker',
    });
    expect(response.data.customer.phone).toBeNull();
    expect(mocks.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'attacker@example.com',
        phone: null,
        phoneVerifiedAt: null,
      }),
    });
    expect(mocks.customer.findFirst).not.toHaveBeenCalled();
  });

  it('баталгаажаагүй утсаар нууц үгээр нэвтрүүлэхгүй', async () => {
    mocks.customer.findUnique.mockResolvedValue({
      id: 'squatter',
      email: 'attacker@example.com',
      phone: '99112233',
      phoneVerifiedAt: null,
      passwordHash: 'hashed',
      name: 'Attacker',
      emailVerifiedAt: new Date(),
    });
    await expect(
      invoke(publicAuthRouter, 'post', '/login', {
        phone: '99112233',
        password: 'secret1',
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it('и-мэйл+нууц үгээр нэвтрэлт утаснаас хамаарахгүй', async () => {
    mocks.customer.findUnique.mockResolvedValue({
      id: 'squatter',
      email: 'attacker@example.com',
      phone: '99112233',
      phoneVerifiedAt: null,
      passwordHash: 'hashed',
      name: 'Attacker',
      emailVerifiedAt: new Date(),
    });
    const response = await invoke(publicAuthRouter, 'post', '/login', {
      email: 'attacker@example.com',
      password: 'secret1',
    });
    expect(response.data.customer.id).toBe('squatter');
    expect(response.data.token).toBe('token');
  });

  it('баталгаажсан утсаар нууц үгээр нэвтрүүлнэ', async () => {
    mocks.customer.findUnique.mockResolvedValue({
      id: 'owner',
      email: 'owner@example.com',
      phone: '99112233',
      phoneVerifiedAt: new Date(),
      passwordHash: 'hashed',
      name: 'Owner',
      emailVerifiedAt: new Date(),
    });
    const response = await invoke(publicAuthRouter, 'post', '/login', {
      phone: '99112233',
      password: 'secret1',
    });
    expect(response.data.customer.id).toBe('owner');
  });
});
