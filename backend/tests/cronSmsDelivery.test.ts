import type { Request, Response, Router } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/lib/errors.js';

const state = vi.hoisted(() => ({
  secret: 'test-cron-secret' as string | undefined,
  prod: true,
  poll: vi.fn(async () => ({ checked: 2, delivered: 1 })),
}));

vi.mock('../src/env.js', () => ({
  get env() {
    return { CRON_SECRET: state.secret };
  },
  get isProd() {
    return state.prod;
  },
}));

vi.mock('../src/services/smsDeliveryJob.js', () => ({
  pollSmsDeliveries: (...args: unknown[]) => state.poll(...args),
}));

import { cronRouter } from '../src/routes/cron.js';

function invoke(router: Router, method: 'get' | 'post', path: string, authorization?: string) {
  const layer = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> }).stack.find(
    (item) => item.route?.path === path && item.route.methods[method],
  );
  if (!layer?.route) throw new Error(`route ${method} ${path} missing`);
  const handle = layer.route.stack.at(-1)!.handle;
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
  state.poll.mockClear();
  state.poll.mockResolvedValue({ checked: 2, delivered: 1 });
});

describe('GET /api/cron/sms-delivery', () => {
  it('зөв Bearer-ээр poll хийнэ, SMS дахин илгээхгүй', async () => {
    const result = await invoke(cronRouter, 'get', '/sms-delivery', 'Bearer test-cron-secret');
    expect(result).toEqual({ status: 200, body: { data: { checked: 2, delivered: 1 } } });
    expect(state.poll).toHaveBeenCalledOnce();
  });

  it('буруу эсвэл байхгүй Bearer-ийг хаана', async () => {
    expect(await invoke(cronRouter, 'get', '/sms-delivery')).toMatchObject({
      status: 401,
      body: { code: 'UNAUTHORIZED' },
    });
    expect(await invoke(cronRouter, 'get', '/sms-delivery', 'Bearer other')).toMatchObject({
      status: 401,
      body: { code: 'UNAUTHORIZED' },
    });
    expect(state.poll).not.toHaveBeenCalled();
  });

  it('production дээр CRON_SECRET байхгүй бол хаагдана', async () => {
    state.secret = undefined;
    expect(await invoke(cronRouter, 'post', '/sms-delivery', 'Bearer test-cron-secret')).toMatchObject({
      status: 401,
      body: { message: 'CRON_SECRET тохиргоо дутуу.' },
    });
    expect(state.poll).not.toHaveBeenCalled();
  });
});
