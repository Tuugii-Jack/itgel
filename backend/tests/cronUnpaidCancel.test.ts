import type { Request, Response, Router } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/lib/errors.js';

const state = vi.hoisted(() => ({
  secret: 'test-cron-secret' as string | undefined,
  prod: true,
  cancel: vi.fn(async (): Promise<number> => 2),
}));

vi.mock('../src/env.js', () => ({
  get env() {
    return { CRON_SECRET: state.secret };
  },
  get isProd() {
    return state.prod;
  },
}));

vi.mock('../src/cron/index.js', () => ({
  cancelUnpaidOrders: () => state.cancel(),
}));

vi.mock('../src/services/smsDeliveryJob.js', () => ({
  pollSmsDeliveries: async () => ({ checked: 0, delivered: 0 }),
}));

import { cronRouter } from '../src/routes/cron.js';

type RouteHandle = (req: Request, res: Response, next: (err?: unknown) => void) => void;
type RouterLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RouteHandle }>;
  };
};

function invoke(router: Router, method: 'get' | 'post', path: string, authorization?: string) {
  const layer = (router as unknown as { stack: RouterLayer[] }).stack.find(
    (item) => item.route?.path === path && item.route.methods[method],
  );
  if (!layer?.route) throw new Error(`route ${method} ${path} missing`);
  const last = layer.route.stack.at(-1);
  if (!last) throw new Error(`route ${method} ${path} has no handler`);
  const handle = last.handle;
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    let status = 200;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(body: unknown) {
        resolve({ status, body });
      },
    } as Response;
    const req = { headers: authorization ? { authorization } : {} } as Request;
    handle(req, res, (err: unknown) => {
      if (err instanceof AppError) resolve({ status: err.status, body: { code: err.code, message: err.message } });
      else reject(err);
    });
  });
}

beforeEach(() => {
  state.secret = 'test-cron-secret';
  state.prod = true;
  state.cancel.mockClear();
  state.cancel.mockResolvedValue(2);
});

describe('GET /api/cron/unpaid-cancel', () => {
  it('SMS cron-оос тусдаа, зөв Bearer-ээр цуцлалт дуудна', async () => {
    const result = await invoke(cronRouter, 'get', '/unpaid-cancel', 'Bearer test-cron-secret');
    expect(result).toEqual({ status: 200, body: { data: { cancelled: 2 } } });
    expect(state.cancel).toHaveBeenCalledOnce();
  });

  it('давхар дуудлага хоёулаа cancelUnpaidOrders-ыг дуудна — stock lock нь давхар буцаалтыг хориглоно', async () => {
    const [a, b] = await Promise.all([
      invoke(cronRouter, 'post', '/unpaid-cancel', 'Bearer test-cron-secret'),
      invoke(cronRouter, 'post', '/unpaid-cancel', 'Bearer test-cron-secret'),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(state.cancel).toHaveBeenCalledTimes(2);
  });

  it('буруу Bearer-ийг хаана', async () => {
    expect(await invoke(cronRouter, 'get', '/unpaid-cancel')).toMatchObject({
      status: 401,
      body: { code: 'UNAUTHORIZED' },
    });
    expect(state.cancel).not.toHaveBeenCalled();
  });
});
